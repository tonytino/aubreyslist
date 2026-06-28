/**
 * First-admin seeding CLI: `pnpm db:seed-admin <email>` (#128, ADR-010).
 *
 * Why this script exists at all: the in-app `setRole` server fn (#16) is
 * deliberately unable to mint admins — it only grants/revokes the `moderator`
 * role — so the **first** admin (the repo owner, per ADR-010) has to be promoted
 * out-of-band, once per database/environment. This replaces hand-written SQL
 * with one repeatable, idempotent command.
 *
 * Constraints it respects:
 * - Reads `DATABASE_URL` only through the validated `getEnv()` accessor (via
 *   `getDb()`), never raw `process.env` (AGENTS.md Hard Rules).
 * - **Never inserts** a row. Identity anchors on `google_sub` (ADR-006), which
 *   only exists after the account signs in once, so seeding by email alone would
 *   create an orphaned/unreachable row. If the user isn't found we exit non-zero
 *   with an actionable message instead.
 * - **Idempotent:** a user who is already `admin` is reported as a no-op success.
 *
 * Structure: the testable core is {@link seedAdmin}, which takes its DB as an
 * injected dependency so unit tests can mock it (per `docs/agents/testing.md`).
 * The CLI shell ({@link runCli}) only parses the email arg, wires the real
 * `getDb()`, prints, and sets the exit code — it is intentionally thin.
 */

import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { type User, users } from "~/db/schema";

/** Minimal DB surface {@link seedAdmin} needs — lets tests inject a mock. */
export interface SeedAdminDb {
  query: {
    users: {
      findFirst(args: {
        where: ReturnType<typeof eq>;
      }): Promise<User | undefined>;
    };
  };
  update(table: typeof users): {
    set(values: Partial<User>): {
      where(condition: ReturnType<typeof eq>): {
        returning(): Promise<User[]>;
      };
    };
  };
}

/** Dependencies for {@link seedAdmin}; defaults to the real Drizzle client. */
export interface SeedAdminDeps {
  db: SeedAdminDb;
}

/** Outcome of a seed run, for the CLI shell to report. */
export interface SeedAdminResult {
  /** `"promoted"` when the role was changed, `"noop"` when already an admin. */
  status: "promoted" | "noop";
  user: User;
  message: string;
}

/**
 * Thrown when no `users` row matches the email. The user must sign in once
 * (which creates the row keyed on `google_sub`) before they can be promoted.
 */
export class UserNotFoundError extends Error {
  readonly email: string;

  constructor(email: string) {
    super(`No user with ${email} — sign in once with this Google account first, then re-run.`);
    this.name = "UserNotFoundError";
    this.email = email;
  }
}

/** Thrown when the email argument is missing or empty (CLI misuse). */
export class InvalidEmailArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEmailArgError";
  }
}

/**
 * Promote an existing user to `admin` by email. Core, dependency-injected logic.
 *
 * - Looks up the row by email; throws {@link UserNotFoundError} if absent (never
 *   inserts).
 * - Already `admin` → no-op success (idempotent).
 * - Otherwise issues `UPDATE users SET role = 'admin', updatedAt = now WHERE
 *   email = ...` and reports the promotion.
 *
 * @throws {InvalidEmailArgError} if `email` is empty/whitespace.
 * @throws {UserNotFoundError} if no user matches.
 */
export async function seedAdmin(email: string, deps: SeedAdminDeps): Promise<SeedAdminResult> {
  const normalized = email.trim();
  if (normalized.length === 0) {
    throw new InvalidEmailArgError("An email argument is required.");
  }

  const { db } = deps;

  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalized),
  });

  if (!existing) {
    throw new UserNotFoundError(normalized);
  }

  if (existing.role === "admin") {
    return {
      status: "noop",
      user: existing,
      message: `${normalized} is already an admin — nothing to do.`,
    };
  }

  const updated = await db
    .update(users)
    .set({ role: "admin", updatedAt: new Date() })
    .where(eq(users.email, normalized))
    .returning();

  const row = updated[0] ?? existing;
  return {
    status: "promoted",
    user: row,
    message: `Promoted ${normalized} to admin (was '${existing.role}').`,
  };
}

/** Usage string printed on argument misuse. */
export const USAGE = "Usage: pnpm db:seed-admin <email>";

/**
 * CLI shell: parse the email arg, run {@link seedAdmin} against the real DB, and
 * return a process exit code. Kept thin and side-effect-light so it is easy to
 * reason about; all the real logic lives in {@link seedAdmin}.
 *
 * Exit codes: `0` success (promoted or already-admin), `2` argument misuse,
 * `1` any other failure (user not found, DB error).
 */
export async function runCli(
  argv: string[],
  deps?: SeedAdminDeps,
  log: Pick<Console, "log" | "error"> = console
): Promise<number> {
  const email = argv[0];

  if (email === undefined || email.trim().length === 0) {
    log.error(USAGE);
    return 2;
  }

  try {
    // Construct the real DB (and thus validate DATABASE_URL via getEnv) only
    // after the arg passes — so misuse fails fast without needing an env/DB.
    const resolved = deps ?? { db: getDb() };
    const result = await seedAdmin(email, resolved);
    log.log(result.message);
    return 0;
  } catch (error) {
    if (error instanceof InvalidEmailArgError) {
      log.error(USAGE);
      return 2;
    }
    log.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// Run when invoked directly (not when imported by tests). `getDb()` — and thus
// `getEnv()`/DATABASE_URL validation — is only touched on this path.
if (import.meta.url === `file://${process.argv[1]}`) {
  // `argv[2]` is the first user-supplied arg after `node <script>`.
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      // Last-resort guard; runCli already handles expected failures.
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
