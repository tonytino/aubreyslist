# Local Secrets (1Password)

**Decision rule:** when handing the owner a manual command that needs a secret,
never ask them to paste the secret or hardcode it. Read it inline from the
1Password CLI (`op`) so the value never lands in shell history, the transcript,
or a committed file.

Every project secret lives in one secure note:

- **Vault:** `Private`
- **Item:** `Aubrey's List Tokens` (a Secure Note; note the apostrophe + capital `T`)

## The command pattern (use `op item get --fields`, NOT `op://` references)

`op read "op://…"` rejects the apostrophe in the item name (and spaces are
fragile). Use `op item get`, where the name is an ordinary shell argument:

```bash
op item get "Aubrey's List Tokens" --vault Private --fields label=<FIELD_NAME> --reveal
```

- `--reveal` is **required** for a concealed field's real value; without it you
  get a masked placeholder.
- `label=<FIELD_NAME>` matches the exact field label (table below).
- Inline it into the command the owner runs:

  ```bash
  GOOGLE_PLACES_API_KEY="$(op item get "Aubrey's List Tokens" --vault Private --fields label=GOOGLE_PLACES_API_KEY --reveal)" pnpm db:seed:refresh
  ```

- The owner must have `op` unlocked (`op signin` or biometric) first. Chain with
  `&&` so a failed read stops the command.
- If `op` can't resolve the item by name, get its ID once and use that instead:

  ```bash
  op item get "Aubrey's List Tokens" --vault Private --format json | jq -r .id
  ```

## Field map

Labels are unique across the item, so `--fields label=<name>` needs no section;
sections are listed for orientation.

| Section                     | Field (`label=`)         | Concealed? | What it is / where it's also needed |
| --------------------------- | ------------------------ | ---------- | ----------------------------------- |
| **Google Cloud**            | `GOOGLE_CLIENT_SECRET`   | yes        | Google OAuth client secret (ADR-006). |
| (project "My First Project")| `GOOGLE_CLIENT_ID`       | no         | Google OAuth client ID (public by nature). |
|                             | `GOOGLE_PLACES_API_KEY`  | yes        | Server-side Places key (ADR-008). Used by `pnpm db:seed:refresh` to bake the Denver seed data. |
| **Neon**                    | `NEON_PROJECT_ID`        | no         | Neon project identifier (a slug, not a credential). In GitHub it lives as a repo **Variable**. |
|                             | `NEON_API_KEY`           | yes        | Neon API key — resolves preview branch DB URLs. In GitHub, a repo **Secret**. |
|                             | `DATABASE_URL`           | yes        | Dev/local Neon connection string. |
|                             | `PROD_DATABASE_URL`      | yes        | Production Neon connection string. GitHub **Secret** used by `seed-prod.yml` / `migrate.yml`. |
|                             | `CI_E2E_DATABASE_URL`    | yes        | Throwaway CI Neon branch URL. GitHub **Secret** used by `ci.yml`. |
| **Session Forgery Protection** | `SESSION_SECRET`      | yes        | Session-signing secret (min 32 chars). |
|                             | `PREVIEW_LOGIN_SECRET`   | yes        | Preview-environment login secret. |
| **Sentry**                  | `SENTRY_AUTH_TOKEN`      | yes        | Sentry source-map upload token (build-time only). |

## GitHub Actions vs. local

The note is the owner's source of truth to copy from — CI never reads it. GitHub
Actions reads the repo's own **Secrets** (sensitive) and **Variables**
(non-sensitive identifiers) under *Settings → Secrets and variables → Actions*:

- `NEON_API_KEY`, `PROD_DATABASE_URL`, `CI_E2E_DATABASE_URL`, `GOOGLE_PLACES_API_KEY`
  → repo **Secrets**.
- `NEON_PROJECT_ID` → repo **Variable** (workflows read `vars.NEON_PROJECT_ID`
  with a `secrets.NEON_PROJECT_ID` fallback).

A manual local command reads from `op`; a workflow reads from `secrets.*` /
`vars.*`. Don't tell the owner to add a secret to GitHub that only a manual
command needs — or vice versa.
