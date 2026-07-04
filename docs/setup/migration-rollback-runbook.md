# Migration Rollback Runbook — AUB-154

> Operational guide for recovering from a failed or problematic Drizzle migration
> in production.
>
> Related: AUB-153 (migration approval gate) and AUB-151 (backup/restore strategy).

---

## Overview

Drizzle migrations are **forward-only** — the migration system does not ship
"down" tooling (no rollback, no undo). This is intentional: reversing a breaking
change requires careful thought, and a production database cannot afford to guess.

When a migration breaks production, the recovery path depends on whether the
change was **data-destructive** (dropped columns/tables) or merely **logic-breaking**
(a constraint issue, wrong DDL, etc.). **Always prefer forward-fixing** — applying
a new corrective migration — unless you have no choice.

---

## Decision Tree

```
Has the change destroyed data?
├─ NO (constraint violation, wrong type, fixable schema issue)
│  └─→ Forward-fix (most common)
│
└─ YES (column/table dropped, data deleted, unrecoverable loss)
   └─→ Neon PITR restore (destructive fallback)
```

---

## Path 1: Forward-Fixing (Default)

**When:** The migration didn't delete data, just applied a constraint or DDL
structure that broke queries or logic.

**Time:** ~5–15 minutes (write + apply fix).

### Procedure

1. **Identify the problem** from prod logs or monitoring. E.g.: a new `NOT NULL`
   constraint is rejecting legitimate writes, or a renamed column broke a query.

2. **Write a corrective migration** — a new `.sql` file in `db/migrations/` that
   fixes the broken state without destroying data. Examples:

   - **Constraint too strict:** drop or relax the constraint.
   - **Wrong column type:** `ALTER TABLE` to the correct type (lossy conversions
     are rare; most type changes are backward-compatible within Postgres).
   - **Column renamed incorrectly:** add back an old name as a view or copy the
     data to the correct column, then drop the wrong one.
   - **Logic issue:** the migration is fine, but dependent code changed — merge
     the code fix and redeploy (no new migration needed).

3. **In code: update `db/schema.ts`** to match the corrected DDL. E.g. if the
   migration softens a constraint, remove the `.notNull()` from the schema.

4. **Run `pnpm db:generate`** — this auto-generates a fresh migration file from
   the schema diff. Drizzle will create the corrective migration with a new
   timestamp.

5. **Test locally:** `pnpm db:migrate` against your dev database, confirm the
   data is intact and the schema is now correct.

6. **Commit & push to `main`** — the `.github/workflows/migrate.yml` workflow
   applies it automatically (or trigger it on-demand from the Actions tab).

7. **Verify:** once CI migration passes (`pnpm db:verify` checks for drift), the
   prod database is fixed. Redeploy the app code if it was waiting for the
   schema.

### Example: Re-Adding a Dropped Column

Suppose a migration dropped `users.phone_number` accidentally:

1. In `db/schema.ts`, add the column back:

   ```ts
   export const users = pgTable("users", {
     id: text("id").primaryKey(),
     // ... other columns ...
     phoneNumber: text("phone_number"), // re-add, optional for now
   });
   ```

2. Run `pnpm db:generate`. Drizzle creates something like:

   ```sql
   -- db/migrations/0005_sad_silver_samurai.sql
   ALTER TABLE "users" ADD COLUMN "phone_number" text;
   ```

3. Commit, push, and the workflow applies it. Old data is still gone (you lost
   it when the original drop ran), but new writes can now use the column again.

4. If you had backups and want to restore the old values, that's a manual
   backfill after the migration — see [Neon PITR](#path-2-neon-pitr-restore-destructive-fallback) for
   how to retrieve the data.

---

## Path 2: Neon PITR Restore (Destructive Fallback)

**When:** A migration deleted data you cannot recover otherwise (dropped a
critical column/table). **Only when forward-fixing is not possible.**

**Time:** ~30–60 minutes (restore + re-apply migrations).

**Caveat:** PITR works **only if backups are enabled** and the incident is
within the **retention window** (typically 7 days on Neon Pro). For smaller
retention or no backups, data loss is permanent.

### Prerequisites

- **Neon Pro or higher** (required for PITR; free tier has none).
- **Backup enabled** and the delete is within the retention window.
- **Access to Neon Console** (as the account owner or admin).

### Procedure

1. **Record the time of the bad migration.** You'll restore to a point just
   before it ran. Check `.github/workflows/migrate.yml` or the Actions tab for
   the exact timestamp.

2. **In [Neon Console](https://console.neon.tech), go to your project** →
   **Branches** → **main** (or your prod branch).

3. **Click "Restore from backup"** (or the PITR icon) → choose the target time
   (seconds before the migration ran).

4. **Start the restore.** Neon creates a temporary clone at that point in time.
   While it restores (1–5 minutes, depending on DB size), plan step 5.

5. **Revert the bad migration commit.** Revert the entire commit that introduced
   the bad migration from your `main` branch. This is simpler and safer than
   manually deleting individual files, because it keeps `db/migrations/*.sql`,
   `db/migrations/meta/_journal.json`, and `db/migrations/meta/<idx>_snapshot.json`
   automatically in sync. If you manually delete only the `.sql` file, the
   journal entry will remain, causing `pnpm db:verify` and Drizzle tooling to
   crash when they try to read the missing file.

6. **Promote the restored branch** to become the new production branch (Neon
   UI). This swap is the actual "rollback" — your app now points to the
   pre-disaster database.

7. **Test the app** on the restored database (a preview deployment helps). If
   the restore worked, you should see the old data and no errors.

8. **Figure out what went wrong** in the migration and write a corrective
   forward-fix (Path 1) instead of the bad migration. Then:

   - Keep the migration files on `main` (or delete and re-generate a clean
     migration).
   - Apply the forward-fix to the restored branch.
   - Verify all migrations are recorded correctly (`pnpm db:verify`).

9. **Re-apply any migrations that were undone** (if you reverted migration files
   in step 5, re-commit them or generate fresh ones that apply to the current
   schema state).

10. **Redeploy the app** to the restored database with the corrected migration.

### Example: Recovering from an Accidental Table Drop

1. A migration accidentally ran `DROP TABLE listings`. You have a Neon Pro
   backup from 2 hours ago.

2. Note the drop time from the Actions tab (e.g., `2026-07-04 14:23:00 UTC`).

3. In Neon Console, restore to `14:22:45 UTC` (before the drop).

4. The restored branch now has the `listings` table with all the data from that
   moment.

5. On your local `main` branch, revert the commit that introduced the bad
   migration (e.g., the commit with `db/migrations/0042_drop_listings.sql`).
   This automatically keeps the migration files, journal, and snapshots in sync.

6. Verify the current schema in `db/schema.ts` still defines `listings`.

7. Run `pnpm db:generate` to check if the restored branch's DDL matches the
   schema. Since the restored branch already has the table, Drizzle should
   detect no drift — that's correct.

8. Push the reverted `main` to your repo. Trigger the migrate workflow manually
   (from the Actions tab) to apply migrations to the restored branch. It should
   report zero migrations applied (table already exists because of the restore).

9. Verify with `pnpm db:verify` that the migration journal matches the database.

10. Redeploy the app to the restored database.

---

## Related Tasks

- **AUB-153: Migration approval gate** — a code-review requirement for
  schema changes to catch destructive patterns before they merge.
- **AUB-151: Backup and restore strategy** — broader operational backup
  policy (PITR retention, backup windows, testing restores).

---

## Checklist: When a Migration Goes Wrong

- [ ] Identify whether data was destroyed or just DDL is broken.
- [ ] If DDL-broken only: write a corrective forward-fix migration
  (`db/schema.ts` + `pnpm db:generate`).
- [ ] If data-destructive: check Neon backup availability; if available, do a
  PITR restore.
- [ ] If no backups or outside retention window: data loss is final. Document
  the loss, notify stakeholders, and update runbook with what-went-wrong.
- [ ] Commit fixes and verify with `pnpm db:verify` that the migration journal
  matches the database.
- [ ] Redeploy the app.

---

## Prevention

This runbook is reactive. The better strategy is to prevent destructive
migrations in the first place:

- **Approval gate (AUB-153):** require a human reviewer to explicitly sign off
  on schema PRs that drop columns, tables, or add strict constraints.
- **Backups (AUB-151):** maintain working PITR backups and test restores
  regularly.

Until those are in place, treat every production schema change as a minor
incident — review logs, watch error rates for 5–10 minutes post-deployment, and
keep this runbook in your muscle memory.
