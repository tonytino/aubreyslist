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
 * matching row in the database's applied-migrations history. Matching is first
 * by the SAME hash the migrator records — sha256 (hex) over the RAW bytes of
 * the migration's `.sql` file (see `readMigrationFiles` in
 * `node_modules/drizzle-orm/migrator.js`; no normalization is applied) — and,
 * failing that, by the recorded journal timestamp (`created_at` stores the
 * journal `when`, not a wall clock):
 *  - Hash match → applied, OK.
 *  - No hash match but an UNCLAIMED applied row exists AT THE ENTRY'S `when` →
 *    DRIFTED: the migrator ran SOME content in that journal slot, but not the
 *    current file's. The bookkeeping table stores only (hash, created_at) — no
 *    tags — so benign drift (a documented hand-edit landing after a DB applied
 *    a draft, e.g. `0002_old_tigra`) is STRUCTURALLY INDISTINGUISHABLE from
 *    harmful drift (a migration renumbered AND content-edited while keeping its
 *    timestamp, whose new SQL never ran). Therefore drift is tolerated ONLY for
 *    tags a human has verified and listed in {@link KNOWN_DRIFTED_TAGS}; any
 *    OTHER drifted tag FAILS the run until it is either fixed with a fresh
 *    migration or explicitly allowlisted.
 *  - Neither → MISSING: the silent-skip hazard → exit 1, naming each tag.
 * Applied rows are CLAIMED 1:1 (first by hash, then one row per drifted entry's
 * `when`), so a single row can never simultaneously back a drifted entry and
 * hide a truly-missing one, and duplicate-timestamp rows aren't swept together.
 * EXTRA applied rows (e.g. an old migration that was later renamed away but had
 * already been applied) are reported as info, never a failure — history a DB
 * has is allowed to be a superset of the current journal.
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

/**
 * Tags whose applied-hash drift has been HUMAN-VERIFIED as benign, so the check
 * reports them as a warning instead of failing. Add a tag here ONLY after
 * confirming why the long-lived DBs' recorded hash differs from the committed
 * file AND that the difference cannot leave any DB's schema stale.
 *
 * - `0002_old_tigra`: the persistent CI Neon branch applied a draft of this
 *   migration before its documented hand-edit (the prepended data-purge DELETE
 *   — see the header comment in `db/migrations/0002_old_tigra.sql`). The edit
 *   changed no DDL, so every DB's schema is identical whether or not the
 *   DELETE ran; the recorded draft hash simply predates the final file.
 */
export const KNOWN_DRIFTED_TAGS: ReadonlySet<string> = new Set(["0002_old_tigra"]);

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
  /** Human-verified benign-drift tags; defaults to {@link KNOWN_DRIFTED_TAGS}. */
  allowedDriftTags?: ReadonlySet<string>;
}

/** What a verification run found, for the CLI shell to report. */
export interface VerifyMigrationsResult {
  /** True when every journal entry has a matching applied row (drift tolerated). */
  ok: boolean;
  /** False when the bookkeeping table doesn't exist (migrate never ran here). */
  bookkeepingTableExists: boolean;
  /** Journal entries with NO matching applied row — the silent-skip hazard. */
  missing: JournalMigration[];
  /**
   * ALLOWLISTED entries whose hash matches no applied row but whose `when`
   * claimed an applied row's recorded timestamp: human-verified benign drift
   * (the DB ran a since-edited version of the file). A WARNING, not a failure.
   */
  drifted: JournalMigration[];
  /**
   * Drift-shaped entries NOT in the allowlist. Indistinguishable from a
   * renumbered-and-edited migration whose new SQL never ran, so these FAIL the
   * run until a human either ships a fresh migration or allowlists the tag.
   */
  unexpectedDrift: JournalMigration[];
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
 * - Every journal entry must match an applied row BY HASH; failing that, it may
 *   CLAIM one still-unclaimed applied row at its exact `when` — allowlisted tags
 *   become `drifted` (warn), all others `unexpectedDrift` (fail). An entry with
 *   neither goes to `missing` (fail): a genuinely skipped migration (the
 *   favorites incident) leaves no row at its `when` at all.
 * - Rows are claimed 1:1 (hash matches first, then one row per drift claim), so
 *   a single row can't back two entries and duplicate-timestamp rows aren't
 *   swept together. Unclaimed rows go to `extraApplied` (info only) — a
 *   long-lived DB legitimately carries history for since-renamed tags.
 * - A missing bookkeeping table means NOTHING was ever applied here: every
 *   journal entry is missing (unless the journal is empty too).
 */
export async function verifyMigrations(
  journal: JournalMigration[],
  deps: VerifyMigrationsDeps
): Promise<VerifyMigrationsResult> {
  const { execute, allowedDriftTags = KNOWN_DRIFTED_TAGS } = deps;

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
      drifted: [],
      unexpectedDrift: [],
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

  // Claim applied rows 1:1. Pass 1: hash matches (a row backs at most one
  // journal entry). Pass 2: each still-unmatched entry may claim ONE unclaimed
  // row at its exact `when` — drift. Whatever remains unclaimed is extra.
  const unclaimed = applied.map((row) => ({ row, claimed: false }));
  const journalHashes = new Set(journal.map((entry) => entry.hash));

  const unmatched: JournalMigration[] = [];
  for (const entry of journal) {
    const byHash = unclaimed.find((slot) => !slot.claimed && slot.row.hash === entry.hash);
    if (byHash) {
      byHash.claimed = true;
    } else {
      unmatched.push(entry);
    }
  }

  const drifted: JournalMigration[] = [];
  const unexpectedDrift: JournalMigration[] = [];
  const missing: JournalMigration[] = [];
  for (const entry of unmatched) {
    const byWhen = unclaimed.find((slot) => !slot.claimed && slot.row.createdAt === entry.when);
    if (!byWhen) {
      // No row ever landed in this journal slot — the genuine silent skip.
      missing.push(entry);
      continue;
    }
    byWhen.claimed = true;
    // SOME content ran at this slot, but not the current file's. Only a
    // human-verified allowlisted tag is benign; anything else could be a
    // renumbered-and-edited migration whose new SQL never ran.
    (allowedDriftTags.has(entry.tag) ? drifted : unexpectedDrift).push(entry);
  }

  const extraApplied = unclaimed
    .filter((slot) => !slot.claimed && !journalHashes.has(slot.row.hash))
    .map((slot) => slot.row);

  return {
    ok: missing.length === 0 && unexpectedDrift.length === 0,
    bookkeepingTableExists: true,
    missing,
    drifted,
    unexpectedDrift,
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

    if (result.drifted.length > 0) {
      // Warning only for ALLOWLISTED tags: the migrator ran a (since-edited)
      // version of this journal slot and a human has verified the difference is
      // benign — see KNOWN_DRIFTED_TAGS for the per-tag justification.
      log.log(
        `warn: ${result.drifted.length} journal migration(s) were applied with a DIFFERENT content hash (allowlisted, human-verified benign drift) — tolerated:`
      );
      for (const entry of result.drifted) {
        log.log(`  DRIFTED  ${entry.tag} (when=${entry.when}, journal sha256=${entry.hash})`);
      }
    }

    if (!result.ok) {
      if (result.missing.length > 0) {
        log.error(
          `FAIL: ${result.missing.length} journal migration(s) have NO matching applied row in ${MIGRATIONS_TABLE_QUALIFIED}:`
        );
        for (const entry of result.missing) {
          log.error(`  MISSING  ${entry.tag} (when=${entry.when}, sha256=${entry.hash})`);
        }
        log.error(
          "This is drizzle's silent-skip hazard: the migrator only applies journal entries whose `when` is greater than the last applied row's timestamp, so a renumbered/re-timestamped migration can be skipped forever while `db:migrate` reports success. Fix by generating a FRESH migration for the missing DDL (never renumber an applied one) — see docs/agents/database.md."
        );
      }
      if (result.unexpectedDrift.length > 0) {
        log.error(
          `FAIL: ${result.unexpectedDrift.length} journal migration(s) were applied with a DIFFERENT content hash and are NOT allowlisted:`
        );
        for (const entry of result.unexpectedDrift) {
          log.error(`  DRIFT  ${entry.tag} (when=${entry.when}, journal sha256=${entry.hash})`);
        }
        log.error(
          "A row exists at this entry's journal timestamp, but its recorded hash doesn't match the committed file — this database ran DIFFERENT content in that slot (an edited-after-apply file, or a renumbered-and-edited migration whose new SQL never ran here). Verify which, ship a FRESH migration if any DDL is actually missing, and only then (if provably benign) add the tag to KNOWN_DRIFTED_TAGS in scripts/verify-migrations.ts — see docs/agents/database.md."
        );
      }
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
