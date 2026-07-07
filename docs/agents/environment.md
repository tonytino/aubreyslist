# Environment Variables

All environment variables are validated with Zod in `app/env.ts`. Validation runs lazily on the first call to `getEnv()` (memoized thereafter), not at import time — so importing modules that depend on env, such as `db/client.ts`, stays safe in tests and non-Node contexts. Invalid env throws a descriptive `Error` rather than exiting the process.

## Current Variables

| Variable                | Required? | Provisioned by | Notes |
| ----------------------- | --------- | -------------- | ----- |
| `DATABASE_URL`          | Required  | human (#19)    | Neon Postgres connection string. |
| `NODE_ENV`              | Optional  | runtime        | `development` \| `production` \| `test`; defaults to `development`. |
| `GOOGLE_CLIENT_ID`      | Optional* | human (#14)    | Google OAuth client ID (ADR-006). Promoted to required by #15. |
| `GOOGLE_CLIENT_SECRET`  | Optional* | human (#14)    | Google OAuth client secret. Promoted to required by #15. |
| `GOOGLE_PLACES_API_KEY` | Optional* | human (#21)    | Server-side Places key (ADR-008). Promoted to required by #22. |
| `SESSION_SECRET`        | Optional* | human (#14)    | Random string for session signing, **min 32 chars** (`openssl rand -base64 32`). Promoted to required by #15. |
| `VERCEL_ENV`            | Optional  | runtime        | Auto-set by Vercel: `production` \| `preview` \| `development`; absent locally. Preview dev-login is **fail-closed** — enabled only for `preview`/`development` (set `VERCEL_ENV=development` in `.env` for local dev-login); unset/`production`/other → disabled (AUB-138). |
| `PREVIEW_LOGIN_SECRET`  | Optional* | human (AUB-138) | Gates the preview-only dev-login endpoint, **min 32 chars** (`openssl rand -base64 32`). Provision **Preview-scoped only** in Vercel, NEVER Production. Absent → endpoint disabled. |
| `VITE_GOOGLE_MAPS_BROWSER_KEY` | Optional | human (AUB-217) | **Public, client-side** browser key for Maps JavaScript API + Maps Embed API (ADR-014). Deliberately client-exposed — its security model is HTTP-referrer restriction + API restriction to those two Maps APIs only; it must never be able to call Places. Distinct from `GOOGLE_PLACES_API_KEY` (server-only); never cross-use the two. NOT in `app/env.ts` — read via the typed accessor in `app/lib/public-env.ts` (see "Public client-side variables" below). Optional by design: map surfaces degrade gracefully to the CSS placeholder / Google Maps deep-link when absent. |

\* The human-provisioned secrets are declared `optional()` for now so
`pnpm preflight` / CI stay green while they're unprovisioned. The auth (#15) and
Places (#22) issues promote them to required as they're wired up. The var names
above are finalized here (#44) and in `.env.example` — they are the source of
truth if the provisioning guide differs.

## Public client-side variables (`VITE_*`)

`app/env.ts`/`getEnv()` guards **runtime, server-side** variables — it is
server-only and unreachable from the browser bundle. A variable the CLIENT
needs is a different animal: Vite statically inlines any `VITE_`-prefixed var
into the shipped JavaScript at **build time**, which makes it public by
definition. Rules for these:

- **Never put a secret in a `VITE_` var.** Only values that are safe to print
  in view-source belong here (e.g. a referrer-restricted Google Maps browser
  key, whose security model is console-side restriction, not concealment).
- **Read them only through a typed accessor in `app/lib/public-env.ts`** —
  never scatter raw `import.meta.env.VITE_*` reads through components. The
  accessor normalizes absent/blank to `null` so callers must handle the
  unprovisioned case explicitly (graceful degradation, e.g. the directory
  map's CSS-placeholder fallback).
- **Type them in `app/vite-env.d.ts`** (the `ImportMetaEnv` augmentation) and
  document them in `.env.example` with an explicit "public by design" note.
- The Hard Rule "no `process.env` outside `app/env.ts`" is untouched: a
  `VITE_` read is `import.meta.env`, compile-time, and non-secret — it is not
  a runtime `process.env` access.

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

3. Call `getEnv()` from `~/env` wherever you need it — never use `process.env` directly:

```ts
import { getEnv } from "~/env";
const env = getEnv();
console.log(env.YOUR_NEW_VAR);
```

`parseEnv(source)` is also exported for unit tests — it validates an arbitrary source and is pure (throws on invalid input, never exits).

## Rules

- Never access `process.env` directly outside of `app/env.ts`.
  - **Narrow exception — build config only:** `vite.config.ts` (and other
    build-time tooling that never ships to the client) may read directly:
    (a) **non-secret platform build flags**, e.g. `process.env.VERCEL` to pick
    the Nitro deployment preset (`nitroV2Plugin`); and (b) **build-time-only
    secrets that are consumed by the build tooling itself and never reach app
    runtime or the client bundle**, e.g. `process.env.SENTRY_AUTH_TOKEN` in
    `sentryTanstackStart` for source-map upload. The rule exists to keep
    **runtime, client-facing secrets** validated and client-safe via
    `getEnv()`; a public build flag isn't a secret, and a build-only secret
    never enters the app module graph that `getEnv()` guards. **Runtime secrets
    must still never be read outside `app/env.ts`** — do not use this exception
    for `DATABASE_URL`, session, or runtime API keys consumed by app code.
  - **Narrow exception — CLI tooling config:** `drizzle.config.ts` reads
    `process.env.DATABASE_URL` directly because Drizzle Kit runs as a CLI
    outside the app module graph and cannot import `getEnv()`. This is the same
    build-time tooling precedent — a secret consumed only by out-of-app-graph
    tooling — not a runtime path.
- Never commit `.env`. It is gitignored.
- Always keep `.env.example` in sync with `app/env.ts`.
- In CI, secrets are injected via GitHub Actions secrets — see `.github/workflows/ci.yml`.

---

## Provisioning DATABASE_URL

This project uses [Neon](https://neon.tech) — a serverless Postgres provider with a free tier.

### Local development

1. Go to [neon.tech](https://neon.tech) and sign in (GitHub login works).
2. Click **New Project** → choose a region close to you → **Create Project**.
3. On the project dashboard, click **Connection Details** and copy the connection string. Either the **Pooled** or **Direct** endpoint works — this template uses Neon's HTTP driver (`drizzle-orm/neon-http`), so the `-pooler` distinction (which matters for the WebSocket `Pool` driver) doesn't apply here.
4. Create `.env` at the project root and paste it in:

```bash
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

5. Run `pnpm db:migrate` to apply the initial schema.

### CI (GitHub Actions)

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name: `CI_E2E_DATABASE_URL`, Value: the same connection string from above.
4. The CI workflow at `.github/workflows/ci.yml` reads `secrets.CI_E2E_DATABASE_URL` and injects it as `DATABASE_URL` for the E2E job. E2E steps are skipped when the secret is absent.

---

## Secret Rotation

When a secret needs to be rotated for security or operational reasons, see the
**[Secret Rotation Runbook](../setup/secret-rotation-runbook.md)** (AUB-188).
It covers SESSION_SECRET, GOOGLE_CLIENT_SECRET, and PREVIEW_LOGIN_SECRET
rotation procedures, including impact and verification steps.
