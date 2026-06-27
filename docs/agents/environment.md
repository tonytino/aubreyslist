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
| `SESSION_SECRET`        | Optional* | human (#14)    | Long random string for session signing. Promoted to required by #15. |

\* The human-provisioned secrets are declared `optional()` for now so
`pnpm preflight` / CI stay green while they're unprovisioned. The auth (#15) and
Places (#22) issues promote them to required as they're wired up. The var names
above are finalized here (#44) and in `.env.example` — they are the source of
truth if the provisioning guide differs.

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
