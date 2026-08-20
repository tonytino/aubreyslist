# Environment Variables

All environment variables are validated with Zod in `app/env.ts`. Validation
runs lazily on the first `getEnv()` call (memoized), not at import time — so
importing env-dependent modules like `db/client.ts` stays safe in tests and
non-Node contexts. Invalid env throws a descriptive `Error` rather than exiting.

## Current Variables

| Variable                | Required? | Provisioned by | Notes |
| ----------------------- | --------- | -------------- | ----- |
| `DATABASE_URL`          | Required  | human (#19)    | Neon Postgres connection string. |
| `NODE_ENV`              | Optional  | runtime        | `development` \| `production` \| `test`; defaults to `development`. |
| `GOOGLE_CLIENT_ID`      | Optional* | human (#14)    | Google OAuth client ID (ADR-006). |
| `GOOGLE_CLIENT_SECRET`  | Optional* | human (#14)    | Google OAuth client secret. |
| `GOOGLE_PLACES_API_KEY` | Optional* | human (#21)    | Server-side Places key (ADR-008). |
| `SESSION_SECRET`        | Optional* | human (#14)    | Random string for session signing, **min 32 chars** (`openssl rand -base64 32`). |
| `VERCEL_ENV`            | Optional  | runtime        | Auto-set by Vercel: `production` \| `preview` \| `development`; absent locally. Preview dev-login is **fail-closed** — enabled only for `preview`/`development` (set `VERCEL_ENV=development` in `.env` for local dev-login); unset/`production`/other → disabled (AUB-138). |
| `PREVIEW_LOGIN_SECRET`  | Optional* | human (AUB-138) | Gates the preview-only dev-login endpoint, **min 32 chars** (`openssl rand -base64 32`). Provision **Preview-scoped only** in Vercel, NEVER Production. Absent → endpoint disabled. |
| `VITE_GOOGLE_MAPS_BROWSER_KEY` | Optional | human (AUB-217) | **Public, client-side** browser key for Maps JavaScript API + Maps Embed API (ADR-014). Deliberately client-exposed — its security model is HTTP-referrer restriction + API restriction to those two Maps APIs only; it must never be able to call Places. Distinct from `GOOGLE_PLACES_API_KEY` (server-only); never cross-use the two. NOT in `app/env.ts` — read via the typed accessor in `app/lib/public-env.ts` (see "Public client-side variables" below). Optional by design: map surfaces degrade gracefully to the CSS placeholder / Google Maps deep-link when absent. |

\* Human-provisioned secrets are declared `optional()` so `pnpm preflight` / CI
stay green while unprovisioned. The var names here and in `.env.example` are the
source of truth if the provisioning guide differs.

## Public client-side variables (`VITE_*`)

`getEnv()` guards **runtime, server-side** variables and is unreachable from the
browser bundle. Vite statically inlines any `VITE_`-prefixed var into the
shipped JavaScript at build time — public by definition. Rules:

- **Never put a secret in a `VITE_` var.** Only values safe to print in
  view-source (e.g. a referrer-restricted Google Maps browser key).
- **Read them only through the typed accessor in `app/lib/public-env.ts`** —
  never scatter raw `import.meta.env.VITE_*` reads through components. The
  accessor normalizes absent/blank to `null` so callers must handle the
  unprovisioned case explicitly (graceful degradation).
- **Type them in `app/vite-env.d.ts`** (the `ImportMetaEnv` augmentation) and
  document them in `.env.example` with an explicit "public by design" note.
- The Hard Rule "no `process.env` outside `app/env.ts`" is untouched: a `VITE_`
  read is `import.meta.env`, compile-time, and non-secret.

## Adding a New Variable

1. Add it to the schema in `app/env.ts`:

```ts
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  YOUR_NEW_VAR: z.string().min(1),
});
```

2. Add it to `.env.example` with an empty value and a comment:

```bash
# Description of what this is and where to get it
YOUR_NEW_VAR=
```

3. Call `getEnv()` from `~/env` wherever you need it — never `process.env`:

```ts
import { getEnv } from "~/env";
const env = getEnv();
console.log(env.YOUR_NEW_VAR);
```

`parseEnv(source)` is also exported for unit tests — pure, validates an
arbitrary source, throws on invalid input.

## Rules

- Never access `process.env` directly outside of `app/env.ts`.
  - **Narrow exception — build config only:** `vite.config.ts` (and other
    build-time tooling that never ships to the client) may read directly:
    (a) **non-secret platform build flags**, e.g. `process.env.VERCEL` to pick
    the Nitro deployment preset; and (b) **build-time-only secrets consumed by
    the build tooling itself and never reaching app runtime or the client
    bundle**, e.g. `process.env.SENTRY_AUTH_TOKEN` in `sentryTanstackStart` for
    source-map upload. **Runtime secrets must still never be read outside
    `app/env.ts`** — do not use this exception for `DATABASE_URL`, session, or
    runtime API keys consumed by app code.
  - **Narrow exception — CLI tooling config:** `drizzle.config.ts` reads
    `process.env.DATABASE_URL` directly because Drizzle Kit runs as a CLI
    outside the app module graph and cannot import `getEnv()`.
- Never commit `.env`. It is gitignored.
- Always keep `.env.example` in sync with `app/env.ts`.
- In CI, secrets are injected via GitHub Actions secrets — see
  `.github/workflows/ci.yml`.

## Provisioning DATABASE_URL

This project uses [Neon](https://neon.tech) — serverless Postgres, free tier.

### Local development

1. Sign in at [neon.tech](https://neon.tech) (GitHub login works).
2. **New Project** → choose a region close to you → **Create Project**.
3. Copy the connection string from **Connection Details**. Either **Pooled** or
   **Direct** works — this template uses Neon's HTTP driver
   (`drizzle-orm/neon-http`), so the `-pooler` distinction doesn't apply.
4. Create `.env` at the project root:

```bash
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

5. Run `pnpm db:migrate` to apply the schema.

### CI (GitHub Actions)

1. Repo → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**: name `CI_E2E_DATABASE_URL`, value the connection
   string.
3. `.github/workflows/ci.yml` injects it as `DATABASE_URL` for the E2E job.
   E2E steps skip when the secret is absent.

## Secret Rotation

See the **[Secret Rotation Runbook](../setup/secret-rotation-runbook.md)**
(AUB-188): SESSION_SECRET, GOOGLE_CLIENT_SECRET, and PREVIEW_LOGIN_SECRET
procedures, with impact and verification steps.
