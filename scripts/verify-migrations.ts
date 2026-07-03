/**
 * Post-migrate verification guard: `pnpm db:verify` (AUB-195).
 *
 * WHY THIS EXISTS: drizzle's migrator (both `drizzle-kit migrate` and the
 * programmatic `migrate()` — they share the same core) applies ONLY the journal
 * entries whose `when` timestamp is STRICTLY GREATER than the LAST applied row's
 * `created_at` in the bookkeeping table (`drizzle.__drizzle_migrations`). So if
 * a migration is ever renumbered/re-timestamped after a long-lived database
 * (the persistent CI Neon branch, a preview branch, prod) has applied a LATER
 * timestamp, the migrator PERMANENTLY SKIPS it — and still reports success.
 * That is exactly how `0003_amazing_meteorite` (the favorites table) was
 * silently skipped on a preview branch while `pnpm db:migrate` exited 0 and the
 * deployed preview then failed with `relation "favorites" does not exist`.
 *
 * THE CHECK: every entry in `db/migrations/meta/_journal.json` must have a
 * matching row in the database's applied-migrations history. Matching is by the
 * SAME hash the migrator records — sha256 (hex) over the RAW bytes of the
 * migration's `.sql` file (see `readMigrationFiles` in
 * `node_modules/drizzle-orm/migrator.js`; no normalization is applied). Any
 * journal entry with no applied row is a divergence → exit 1, naming each
 * missing tag. EXTRA applied rows (e.g. an old migration that was later renamed
 * away but had already been applied) are reported as info, never a failure —
 * history a DB has is allowed to be a superset of the current journal.
 *
 * Design (mirrors `scripts/seed.ts` / `scripts/seed-admin.ts`):
 *  - The testable core is {@link verifyMigrations}: it takes the journal entries
 *    (tag + when + precomputed hash) and an injected SQL EXECUTOR, so unit tests
 *    run against a fake with no live database.
 *  - {@link readJournalMigrations} is the thin fs seam that loads the journal
 *    and hashes each migration file exactly as drizzle does.
 *  - The CLI shell ({@link runCli}) wires the real `getDb()` (so `DATABASE_URL`
 *    is only ever read through the validated `getEnv()` accessor), prints a
 *    report, and sets the exit code: `0` all applied, `1` divergence/failure.
 *
 * Runs via `node --experimental-strip-types` + the dependency-free alias loader
 * (`scripts/register-aliases.mjs`) — no new dependency. Wired into CI right
 * after every `pnpm db:migrate` (ci.yml, migrate.yml, migrate-preview.yml,
 * seed-prod.yml). See docs/agents/database.md → "Never renumber an applied
 * migration".
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";

/**
 * Where drizzle keeps its applied-migrations bookkeeping. These are the
 * migrator's DEFAULTS (this repo's `drizzle.config.ts` does not override them):
 * `drizzle.__drizzle_migrations (id serial, hash text, created_at bigint)` —
 * verified against `node_modules/drizzle-orm/neon-http/migrator.js`.
 */
export const MIGRATIONS_TABLE_QUALIFIED = "drizzle.__drizzle_migrations";

/** One journal entry paired with the hash drizzle would record for it. */
export interface JournalMigration {
  /** The migration tag, e.g. `0003_amazing_meteorite`. */
  tag: string;
  /** The journal `when` timestamp (ms) — what the migrator compares against. */
  when: number;
  /** sha256 (hex) of the raw `.sql` file content — what the migrator records. */
  hash: string;
}

/** One applied row from the bookkeeping table. */
export interface AppliedMigrationRow {
  hash: string;
  /** The recorded journal timestamp (`created_at` bigint), as a number. */
  createdAt: number;
}

/**
 * The single query capability the core needs, injected so tests can fake it.
 * Matches drizzle's `db.execute(sql\`…\`)` result shape (`{ rows }`).
 */
export type SqlExecutor = (query: SQL) => Promise<{ rows: Record<string, unknown>[] }>;

/** Dependencies for {@link verifyMigrations}; the CLI supplies the real ones. */
export interface VerifyMigrationsDeps {
  execute: SqlExecutor;
}

/** What a verification run found, for the CLI shell to report. */
export interface VerifyMigrationsResult {
  /** True when every journal entry has a matching applied row. */
  ok: boolean;
  /** False when the bookkeeping table doesn't exist (migrate never ran here). */
  bookkeepingTableExists: boolean;
  /** Journal entries with NO matching applied row — the silent-skip hazard. */
  missing: JournalMigration[];
  /** Applied rows matching no current journal entry — INFO only, never a failure. */
  extraApplied: AppliedMigrationRow[];
  /** Total applied rows found in the bookkeeping table. */
  appliedCount: number;
}

/** The hash drizzle's migrator records: sha256 (hex) over the RAW file content. */
export function hashMigrationSql(sqlFileContent: string): string {
  return createHash("sha256").update(sqlFileContent).digest("hex");
}

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string(), when: z.number() })),
});

/**
 * Load `meta/_journal.json` from a migrations folder and pair every entry with
 * the sha256 hash of its `.sql` file — EXACTLY the tuple drizzle's
 * `readMigrationFiles` computes, so hash-matching against the bookkeeping table
 * is apples-to-apples. Throws (→ exit 1 in the CLI) when the journal or a
 * referenced migration file is missing/malformed: a broken journal is itself a
 * failure, never something to verify "around".
 */
export function readJournalMigrations(migrationsFolder: string): JournalMigration[] {
  const journalRaw = readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8");
  const journal = journalSchema.parse(JSON.parse(journalRaw));
  return journal.entries.map((entry) => ({
    tag: entry.tag,
    when: entry.when,
    hash: hashMigrationSql(readFileSync(join(migrationsFolder, `${entry.tag}.sql`), "utf8")),
  }));
}

/**
 * Core check, dependency-injected: compare the journal against the database's
 * applied-migrations history.
 *
 * - Every journal entry must match an applied row BY HASH → otherwise it is
 *   reported in `missing` and the result is not ok. (Hash, not timestamp: a
 *   renumbered-but-identical file keeps its hash, so a rename alone doesn't
 *   false-positive; a skipped migration has no applied row at all.)
 * - Applied rows with no journal counterpart go to `extraApplied` (info only) —
 *   a long-lived DB legitimately carries history for since-renamed tags.
 * - A missing bookkeeping table means NOTHING was ever applied here: every
 *   journal entry is missing (unless the journal is empty too).
 */
export async function verifyMigrations(
  journal: JournalMigration[],
  deps: VerifyMigrationsDeps
): Promise<VerifyMigrationsResult> {
  const { execute } = deps;

  // `to_regclass` returns NULL (instead of erroring) for a missing relation, so
  // a never-migrated database is reported cleanly rather than as a query crash.
  const existsResult = await execute(
    sql`select to_regclass('drizzle.__drizzle_migrations') as bookkeeping`
  );
  const bookkeepingTableExists = (existsResult.rows[0]?.bookkeeping ?? null) !== null;

  if (!bookkeepingTableExists) {
    return {
      ok: journal.length === 0,
      bookkeepingTableExists: false,
      missing: [...journal],
      extraApplied: [],
      appliedCount: 0,
    };
  }

  const appliedResult = await execute(
    sql`select hash, created_at from drizzle.__drizzle_migrations`
  );
  const applied: AppliedMigrationRow[] = appliedResult.rows.map((row) => ({
    hash: String(row.hash),
    // `created_at` is a bigint — the Neon HTTP driver returns it as a string.
    createdAt: Number(row.created_at),
  }));

  const appliedHashes = new Set(applied.map((row) => row.hash));
  const journalHashes = new Set(journal.map((entry) => entry.hash));

  const missing = journal.filter((entry) => !appliedHashes.has(entry.hash));
  const extraApplied = applied.filter((row) => !journalHashes.has(row.hash));

  return {
    ok: missing.length === 0,
    bookkeepingTableExists: true,
    missing,
    extraApplied,
    appliedCount: applied.length,
  };
}

/** Resolve the repo's migrations folder relative to this script. */
function defaultMigrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
}

/** Optional injection points for {@link runCli} (tests inject both). */
export interface RunCliDeps {
  execute?: SqlExecutor;
  journal?: JournalMigration[];
}

/**
 * CLI shell: load the journal, query the real database (via `getDb()` — the
 * only `DATABASE_URL` access path, per the Hard Rules), run the core check, and
 * report. Exit codes: `0` every journal entry is applied, `1` any divergence or
 * failure. Kept thin; all real logic is in the injectable core.
 */
export async function runCli(
  deps?: RunCliDeps,
  log: Pick<Console, "log" | "error"> = console
): Promise<number> {
  try {
    const journal = deps?.journal ?? readJournalMigrations(defaultMigrationsFolder());
    const execute: SqlExecutor =
      deps?.execute ??
      (async (query) => {
        const result = await getDb().execute(query);
        return { rows: result.rows as Record<string, unknown>[] };
      });

    const result = await verifyMigrations(journal, { execute });

    if (!result.bookkeepingTableExists) {
      if (result.ok) {
        log.log("No migrations bookkeeping table and an empty journal — nothing to verify.");
        return 0;
      }
      log.error(
        `FAIL: ${MIGRATIONS_TABLE_QUALIFIED} does not exist — migrations were never applied to this database, so every journal entry is missing:`
      );
      for (const entry of result.missing) {
        log.error(`  MISSING  ${entry.tag} (when=${entry.when})`);
      }
      return 1;
    }

    if (result.extraApplied.length > 0) {
      // Info only: a long-lived DB may carry applied history for tags that were
      // later renamed out of the journal. That is tolerated — never a failure.
      log.log(
        `info: ${result.extraApplied.length} applied migration(s) not in the current journal (renamed/renumbered history) — tolerated.`
      );
    }

    if (!result.ok) {
      log.error(
        `FAIL: ${result.missing.length} journal migration(s) have NO matching applied row in ${MIGRATIONS_TABLE_QUALIFIED}:`
      );
      for (const entry of result.missing) {
        log.error(`  MISSING  ${entry.tag} (when=${entry.when}, sha256=${entry.hash})`);
      }
      log.error(
        "This is drizzle's silent-skip hazard: the migrator only applies journal entries whose `when` is greater than the last applied row's timestamp, so a renumbered/re-timestamped migration can be skipped forever while `db:migrate` reports success. Fix by generating a FRESH migration for the missing DDL (never renumber an applied one) — see docs/agents/database.md."
      );
      return 1;
    }

    log.log(
      `OK: all ${journal.length} journal migration(s) are applied (${result.appliedCount} applied row(s) in ${MIGRATIONS_TABLE_QUALIFIED}).`
    );
    return 0;
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// Run when invoked directly (not when imported by tests). `getDb()`/`getEnv()` —
// and thus DATABASE_URL validation — are only touched on this path.
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
