import { z } from "zod";

/**
 * Environment variable schema. Add new variables here — they are validated on
 * first access via {@link getEnv}.
 *
 * Loading: Vinxi/Vite loads `.env` files automatically for `dev`/`build`. For
 * entrypoints that don't go through Vinxi (e.g. drizzle-kit, a raw `node`
 * script, or Vitest), the variables must already be present in `process.env`.
 */
export const envSchema = z
  .object({
    DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // Human-provisioned secret (safe:human, Bucket 1). Conditionally required —
    // `.optional()` here so the base schema still parses in dev/preview/test
    // without it, but `superRefine` below requires it once `VERCEL_ENV ===
    // "production"` (AUB-150). See ADR-006.
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),

    // Human-provisioned secret (safe:human, Bucket 1). Conditionally required —
    // required in production (see the `superRefine` below), optional in
    // development/preview/test (AUB-150). See ADR-006.
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

    // Human-provisioned secret (safe:human, Bucket 1). Server-side Places key —
    // never exposed client-side. Optional until the Places provider issue (#22)
    // wires it and promotes it to required. See ADR-008.
    GOOGLE_PLACES_API_KEY: z.string().min(1).optional(),

    // Human-provisioned secret (safe:human, Bucket 1). Long random string for
    // session signing (`openssl rand -base64 32`). Minimum 32 chars: this key
    // protects every session cookie, so a trivially short value would be weak
    // enough to brute-force. Conditionally required — required in production
    // (see the `superRefine` below), optional in development/preview/test
    // (AUB-150). See ADR-006.
    SESSION_SECRET: z
      .string()
      .min(32, "SESSION_SECRET must be at least 32 characters")
      .optional()
      .describe("Session signing secret; at least 32 chars (openssl rand -base64 32)."),

    // Vercel injects this at runtime on every deployment: `production` on the
    // production domain, `preview` on preview deployments, `development` for
    // `vercel dev`. Absent locally. Used to keep the preview-only dev-login
    // endpoint prod-inert (see app/server/auth/preview-login.ts, AUB-138), and
    // as the discriminator for which secrets are required (AUB-150, below).
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),

    // Human-provisioned secret (safe:human, Bucket 1). Gates the preview-only
    // dev-login endpoint that mints a session WITHOUT Google — a workaround for
    // Google OAuth's exact-match redirect URIs on per-deployment preview URLs.
    // Provision **Preview-scoped only** in Vercel (NEVER Production); generate
    // with `openssl rand -base64 32`. Min 32 chars so it can't be brute-forced.
    // Optional everywhere (absent → the endpoint is disabled). See AUB-138.
    PREVIEW_LOGIN_SECRET: z
      .string()
      .min(32, "PREVIEW_LOGIN_SECRET must be at least 32 characters")
      .optional()
      .describe("Preview-only dev-login secret; at least 32 chars (openssl rand -base64 32)."),
  })
  .superRefine((env, ctx) => {
    // AUB-150: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / SESSION_SECRET are
    // human-provisioned secrets that are now wired up and load-bearing for
    // real sign-in (ADR-006), so a production deploy without them is a
    // misconfiguration we want to fail loudly on, not a valid state. They stay
    // optional in development/preview/test so local dev and CI (which don't
    // provision production secrets) stay green. `VERCEL_ENV` is the
    // discriminator rather than `NODE_ENV` because `NODE_ENV=production` is
    // also what a plain `pnpm build`/local prod-mode run sets, which would
    // otherwise force these secrets in environments that were never meant to
    // have them.
    if (env.VERCEL_ENV !== "production") {
      return;
    }
    if (!env.GOOGLE_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_CLIENT_ID"],
        message: "GOOGLE_CLIENT_ID is required when VERCEL_ENV is production",
      });
    }
    if (!env.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_CLIENT_SECRET"],
        message: "GOOGLE_CLIENT_SECRET is required when VERCEL_ENV is production",
      });
    }
    if (!env.SESSION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SESSION_SECRET"],
        message: "SESSION_SECRET is required when VERCEL_ENV is production",
      });
    }
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

/**
 * Validate and return ONLY the Google Places API key, independent of the rest of
 * the env schema. The seed-data refresh CLI (`scripts/refresh-seed-data.ts`) needs
 * just this key and never opens a database connection, so it must not be forced to
 * provide `DATABASE_URL` (which the full {@link getEnv} requires). This still reads
 * `process.env` only here in `app/env.ts` and still validates what it reads.
 *
 * @throws {Error} If `GOOGLE_PLACES_API_KEY` is missing or empty.
 */
export function getPlacesApiKey(): string {
  const parsed = z
    .string()
    .min(1, "GOOGLE_PLACES_API_KEY is required")
    .safeParse(process.env.GOOGLE_PLACES_API_KEY);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:\n  - GOOGLE_PLACES_API_KEY: ${parsed.error.issues
        .map((issue) => issue.message)
        .join(", ")}`
    );
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

/**
 * Whether this deployment is real Production, per `VERCEL_ENV` (the same
 * server-truth discriminator the production-secret `superRefine` above and
 * `isPreviewLoginEnabled` use) — `preview` and `development` are both `false`
 * here, distinguishing them from `production` (AUB-170). Server-only; client
 * code learns this via `fetchIsProductionEnvironment`
 * (`app/server/env.fn.ts`), never by importing this module directly.
 *
 * Fails CLOSED to `true` (treat as production) if `getEnv()` throws on an
 * unreadable/invalid env, so a misconfigured deployment errs toward hiding
 * error internals rather than leaking them.
 */
export function isProductionEnvironment(): boolean {
  try {
    return getEnv().VERCEL_ENV === "production";
  } catch {
    return true;
  }
}
