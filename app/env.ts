import { z } from "zod";

/**
 * Environment variable schema. Add new variables here — they are validated on
 * first access via {@link getEnv}.
 *
 * Loading: Vinxi/Vite loads `.env` files automatically for `dev`/`build`. For
 * entrypoints that don't go through Vinxi (e.g. drizzle-kit, a raw `node`
 * script, or Vitest), the variables must already be present in `process.env`.
 */
export const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Human-provisioned secret (safe:human, Bucket 1). Optional for now so
  // preflight/CI stay green while it's absent; promoted to required by the
  // auth issue (#15) once Google OAuth is wired up. See ADR-006.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),

  // Human-provisioned secret (safe:human, Bucket 1). Optional until the auth
  // issue (#15) wires Google OAuth and promotes it to required. See ADR-006.
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  // Human-provisioned secret (safe:human, Bucket 1). Server-side Places key —
  // never exposed client-side. Optional until the Places provider issue (#22)
  // wires it and promotes it to required. See ADR-008.
  GOOGLE_PLACES_API_KEY: z.string().min(1).optional(),

  // Human-provisioned secret (safe:human, Bucket 1). Long random string for
  // session signing (`openssl rand -hex 32`). Optional until the auth issue
  // (#15) wires sessions and promotes it to required. See ADR-006.
  SESSION_SECRET: z.string().min(1).optional(),
});

/** Validated environment shape. */
export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate an environment source. Pure and side-effect free: it
 * throws a descriptive `Error` on invalid input instead of calling
 * `process.exit`, so it is safe to call from tests and non-Node runtimes.
 *
 * @param source Raw environment key/value map (defaults to `process.env`).
 * @returns The validated, typed environment.
 * @throws {Error} If any variable is missing or invalid.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const details = Object.entries(fieldErrors)
      .map(([key, errors]) => `  - ${key}: ${errors?.join(", ")}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${details}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

/**
 * Lazily validated environment, memoized after the first call. Use this from
 * server code that needs env vars. Importing this module no longer validates
 * (or crashes) at import time, so modules that transitively depend on it stay
 * importable in tests without a live environment.
 */
export function getEnv(): Env {
  if (cached === undefined) {
    cached = parseEnv();
  }
  return cached;
}
