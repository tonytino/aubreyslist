import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  type AppliedMigrationRow,
  type JournalMigration,
  type SqlExecutor,
  hashMigrationSql,
  readJournalMigrations,
  runCli,
  verifyMigrations,
} from "./verify-migrations";

/**
 * Tests for the post-migrate verification guard (AUB-195). The core takes the
 * journal entries and an injected SQL executor (per `docs/agents/testing.md` /
 * the seed-script pattern), so everything here runs against a fake — no live
 * database. The fake models the two queries the core issues:
 *   1. `to_regclass('drizzle.__drizzle_migrations')` — table existence, and
 *   2. `select hash, created_at from drizzle.__drizzle_migrations` — history.
 */

/** A journal entry with a deterministic fake hash. */
function entry(tag: string, when: number): JournalMigration {
  return { tag, when, hash: hashMigrationSql(`-- ${tag}\nCREATE TABLE "${tag}" (id text);`) };
}

/** Render a query to inspect which of the core's two statements it is. */
const dialect = new PgDialect();

/**
 * Build a fake executor. `applied` rows are returned with `created_at` as a
 * STRING, mirroring how the Neon HTTP driver returns Postgres bigints.
 */
function fakeExecutor(
  applied: AppliedMigrationRow[],
  { tableExists = true }: { tableExists?: boolean } = {}
): SqlExecutor {
  return (query) => {
    const text = dialect.sqlToQuery(query).sql.toLowerCase();
    if (text.includes("to_regclass")) {
      return Promise.resolve({
        rows: [{ bookkeeping: tableExists ? "__drizzle_migrations" : null }],
      });
    }
    return Promise.resolve({
      rows: applied.map((row) => ({ hash: row.hash, created_at: String(row.createdAt) })),
    });
  };
}

const JOURNAL: JournalMigration[] = [
  entry("0000_orange_rockslide", 1_782_600_695_889),
  entry("0001_curvy_captain_britain", 1_782_677_161_497),
  entry("0002_old_tigra", 1_782_789_105_440),
  entry("0003_amazing_meteorite", 1_783_054_251_944),
];

const appliedFor = (entries: JournalMigration[]): AppliedMigrationRow[] =>
  entries.map((e) => ({ hash: e.hash, createdAt: e.when }));

describe("verifyMigrations (core)", () => {
  it("passes when every journal entry has a matching applied row", async () => {
    const result = await verifyMigrations(JOURNAL, { execute: fakeExecutor(appliedFor(JOURNAL)) });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.extraApplied).toEqual([]);
    expect(result.appliedCount).toBe(4);
  });

  it("fails and NAMES the tag when a journal entry was never applied (the silent-skip incident)", async () => {
    // The AUB-195 incident shape: the DB applied everything EXCEPT
    // 0003_amazing_meteorite, which drizzle skipped because a later journal
    // timestamp was already recorded — db:migrate still reported success.
    const applied = appliedFor(JOURNAL.filter((e) => e.tag !== "0003_amazing_meteorite"));
    const result = await verifyMigrations(JOURNAL, { execute: fakeExecutor(applied) });

    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.tag)).toEqual(["0003_amazing_meteorite"]);
  });

  it("tolerates EXTRA applied rows (renamed-but-applied history) as info, not failure", async () => {
    // A long-lived DB that applied old-0003 before it was renumbered away keeps
    // that row forever; its hash matches no current journal entry — allowed.
    const renamedAway = entry("0003_lame_carnage", 1_783_057_253_835);
    const applied = [
      ...appliedFor(JOURNAL),
      { hash: renamedAway.hash, createdAt: renamedAway.when },
    ];
    const result = await verifyMigrations(JOURNAL, { execute: fakeExecutor(applied) });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.extraApplied).toEqual([{ hash: renamedAway.hash, createdAt: renamedAway.when }]);
  });

  it("downgrades a hash mismatch WITH a timestamp match to DRIFTED (warn, not fail)", async () => {
    // The persistent-CI-branch shape: 0002_old_tigra was applied as a draft,
    // then the file was hand-edited (the documented DELETE prepend) — the
    // recorded hash never matches the current file, but a row exists at the
    // entry's `when`, so the migrator DID run that journal slot.
    const editedAfterApply = JOURNAL[2] as JournalMigration;
    const applied = appliedFor(JOURNAL).map((row) =>
      row.createdAt === editedAfterApply.when ? { ...row, hash: "0".repeat(64) } : row
    );
    const result = await verifyMigrations(JOURNAL, { execute: fakeExecutor(applied) });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.drifted.map((d) => d.tag)).toEqual(["0002_old_tigra"]);
    // The timestamp-matched row is the drifted entry's counterpart, not "extra".
    expect(result.extraApplied).toEqual([]);
  });

  it("still FAILS when an unmatched entry has no applied row at its `when` either", async () => {
    // Drift tolerance must not swallow the real hazard: a skipped migration
    // leaves NO row at its journal timestamp at all.
    const applied = appliedFor(JOURNAL.filter((e) => e.tag !== "0003_amazing_meteorite"));
    // Add drift on another entry to prove the two classifications coexist.
    const withDrift = applied.map((row) =>
      row.createdAt === (JOURNAL[2] as JournalMigration).when
        ? { ...row, hash: "f".repeat(64) }
        : row
    );
    const result = await verifyMigrations(JOURNAL, { execute: fakeExecutor(withDrift) });

    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.tag)).toEqual(["0003_amazing_meteorite"]);
    expect(result.drifted.map((d) => d.tag)).toEqual(["0002_old_tigra"]);
  });

  it("matches by HASH, not timestamp — a re-timestamped but identical file still matches", async () => {
    // Renumbering that PRESERVES content keeps the sha256, so an applied row
    // recorded under a different `created_at` still satisfies the journal.
    const applied = JOURNAL.map((e) => ({ hash: e.hash, createdAt: e.when + 999_999 }));
    const result = await verifyMigrations(JOURNAL, { execute: fakeExecutor(applied) });

    expect(result.ok).toBe(true);
  });

  it("reports EVERY journal entry missing when the bookkeeping table does not exist", async () => {
    const result = await verifyMigrations(JOURNAL, {
      execute: fakeExecutor([], { tableExists: false }),
    });

    expect(result.ok).toBe(false);
    expect(result.bookkeepingTableExists).toBe(false);
    expect(result.missing.map((m) => m.tag)).toEqual(JOURNAL.map((e) => e.tag));
  });

  it("passes on a never-migrated database when the journal is empty too", async () => {
    const result = await verifyMigrations([], {
      execute: fakeExecutor([], { tableExists: false }),
    });
    expect(result.ok).toBe(true);
  });
});

describe("runCli (shell)", () => {
  function collectingLog() {
    const lines: string[] = [];
    const errors: string[] = [];
    return {
      lines,
      errors,
      log: { log: (m: string) => lines.push(m), error: (m: string) => errors.push(m) },
    };
  }

  it("exits 0 and reports OK when everything is applied", async () => {
    const { log, lines } = collectingLog();
    const code = await runCli(
      { journal: JOURNAL, execute: fakeExecutor(appliedFor(JOURNAL)) },
      log
    );

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("OK: all 4 journal migration(s) are applied");
  });

  it("exits 1 and names each missing tag on divergence", async () => {
    const { log, errors } = collectingLog();
    const applied = appliedFor(JOURNAL.filter((e) => e.tag !== "0003_amazing_meteorite"));
    const code = await runCli({ journal: JOURNAL, execute: fakeExecutor(applied) }, log);

    expect(code).toBe(1);
    const output = errors.join("\n");
    expect(output).toContain("0003_amazing_meteorite");
    expect(output).toContain("MISSING");
  });

  it("exits 0 with an info line when only extra applied rows exist", async () => {
    const { log, lines } = collectingLog();
    const extra = entry("0003_lame_carnage", 1_783_057_253_835);
    const applied = [...appliedFor(JOURNAL), { hash: extra.hash, createdAt: extra.when }];
    const code = await runCli({ journal: JOURNAL, execute: fakeExecutor(applied) }, log);

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("tolerated");
  });

  it("exits 0 with a warn line naming each DRIFTED tag", async () => {
    const { log, lines } = collectingLog();
    const drifted = JOURNAL[2] as JournalMigration;
    const applied = appliedFor(JOURNAL).map((row) =>
      row.createdAt === drifted.when ? { ...row, hash: "0".repeat(64) } : row
    );
    const code = await runCli({ journal: JOURNAL, execute: fakeExecutor(applied) }, log);

    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain("DRIFTED  0002_old_tigra");
    expect(output).toContain("OK: all 4 journal migration(s) are applied");
  });

  it("exits 1 when the bookkeeping table is missing but the journal is not empty", async () => {
    const { log, errors } = collectingLog();
    const code = await runCli(
      { journal: JOURNAL, execute: fakeExecutor([], { tableExists: false }) },
      log
    );

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("does not exist");
  });

  it("exits 1 when the executor throws (connection/query failure is loud, never a pass)", async () => {
    const { log, errors } = collectingLog();
    const code = await runCli(
      {
        journal: JOURNAL,
        execute: () => Promise.reject(new Error("connection refused")),
      },
      log
    );

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("connection refused");
  });
});

describe("readJournalMigrations (fs seam, against the repo's real migrations)", () => {
  it("loads the committed journal and hashes each migration file like drizzle does", () => {
    // Uses the REAL db/migrations folder — no DB, just fs — so the tuple shape
    // (tag + when + sha256) is proven against the actual committed artifacts.
    const migrations = readJournalMigrations("db/migrations");

    expect(migrations.length).toBeGreaterThanOrEqual(5);
    for (const migration of migrations) {
      expect(migration.tag).toMatch(/^\d{4}_/);
      expect(migration.when).toBeGreaterThan(0);
      // sha256 hex digest — the exact format drizzle records in `hash`.
      expect(migration.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Timestamps are strictly increasing in a healthy journal (the migrator's
    // ordering assumption) — not asserted as a hard rule elsewhere, but true of
    // the committed history this repo ships.
    const whens = migrations.map((m) => m.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
  });
});
