/**
 * Shared CLI plumbing for the `scripts/` commands (`pnpm db:seed`,
 * `db:seed:refresh`, `db:seed-admin`, `db:verify`, `db:backfill:*`).
 *
 * Every one of those scripts is built the same way: a testable, dependency-
 * injected core; a `runCli` shell that returns a process exit code; and a
 * bottom-of-file guard that runs the shell ONLY when the file is executed
 * directly, so importing it from a test never opens a DB connection or reads an
 * env var. This module holds the two pieces of that shape which were identical
 * in every script — the "am I the entry module?" guard and the unknown-error to
 * message narrowing — so the scripts keep only what is actually specific to
 * them (which accessor they touch, what they print, which exit codes they use).
 *
 * Runs via `node --experimental-strip-types` + the dependency-free alias loader
 * (`scripts/register-aliases.mjs`) like the scripts that import it: plain TS
 * with no runtime deps, imported by relative specifier.
 */

/** Narrow an unknown thrown value to a printable message. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Report what a seed-pipeline run could not process, in the shared
 * `Skipped: <query>; <query>` form — nothing is printed when a run skipped
 * nothing. Both `db:seed:refresh` (sources Places couldn't resolve) and
 * `db:seed` (baked entries that couldn't be inserted) end their summary with
 * this line, and the two are read side by side, so the format is shared.
 */
export function logSkipped(
  log: (message: string) => void,
  skipped: ReadonlyArray<{ query: string }>
): void {
  if (skipped.length > 0) {
    log(`Skipped: ${skipped.map((entry) => entry.query).join("; ")}`);
  }
}

/**
 * Run `main` only when `moduleUrl` is the module Node was invoked with — i.e.
 * `node scripts/foo.ts`, never `import "./foo.ts"` from a test. Call it with
 * `import.meta.url` from the script's bottom scope.
 *
 * The resolved exit code becomes `process.exitCode` (set, not `process.exit()`,
 * so pending stdout writes still flush). A rejection is a last-resort guard —
 * each `runCli` already handles its expected failures — and reports as exit 1.
 */
export function runWhenInvokedDirectly(moduleUrl: string, main: () => Promise<number>): void {
  if (moduleUrl !== `file://${process.argv[1]}`) {
    return;
  }

  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    });
}
