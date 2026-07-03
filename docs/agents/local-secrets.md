# Local Secrets (1Password)

When an agent hands the owner a **command to run manually on their own machine**
that needs a secret (a DB URL, an API key, an auth token), do **not** ask them to
paste the secret into chat or hardcode it into the command. Read it from their
**1Password CLI (`op`)** inline, so the value never lands in shell history, the
transcript, or a committed file.

The owner keeps every project secret in one 1Password secure note:

- **Vault:** `Private`
- **Item:** `Aubrey's List Tokens` (a Secure Note; note the apostrophe + capital `T`)

## The command pattern (use `op item get --fields`, NOT `op://` references)

The item name contains an apostrophe, and `op read "op://…"` **rejects `'` as an
invalid character in a secret reference** (spaces are fragile there too). So always
use `op item get` with `--fields`, where the item name is an ordinary shell
argument and the apostrophe is harmless:

```bash
op item get "Aubrey's List Tokens" --vault Private --fields label=<FIELD_NAME> --reveal
```

- `--reveal` is **required** to emit a concealed (password-type) field's real value;
  without it you get a masked placeholder.
- `label=<FIELD_NAME>` matches the field by its exact label (the names in the table
  below).
- Inline it into the command the owner runs, e.g.:

  ```bash
  GOOGLE_PLACES_API_KEY="$(op item get "Aubrey's List Tokens" --vault Private --fields label=GOOGLE_PLACES_API_KEY --reveal)" pnpm db:seed:refresh
  ```

- The owner must have `op` unlocked (`op signin`, or biometric) first, or the read
  fails. Chain with `&&` so a failed read stops the command before it does anything.
- If `op` can't resolve the item by name, get its ID once and use that in place of
  the name:

  ```bash
  op item get "Aubrey's List Tokens" --vault Private --format json | jq -r .id
  ```

## Field map

Field labels are grouped into sections in the note. `op item get --fields
label=<name>` doesn't need the section (labels are unique across the item), but the
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

The note is the owner's **source of truth to copy from** — it is **not** where CI
reads secrets. GitHub Actions reads from the repo's own **Secrets** (sensitive) and
**Variables** (non-sensitive identifiers) under *Settings → Secrets and variables →
Actions*. Notably:

- `NEON_API_KEY`, `PROD_DATABASE_URL`, `CI_E2E_DATABASE_URL`, `GOOGLE_PLACES_API_KEY`
  → repo **Secrets**.
- `NEON_PROJECT_ID` → repo **Variable** (it's an identifier; workflows read
  `vars.NEON_PROJECT_ID` with a `secrets.NEON_PROJECT_ID` fallback).

So a manual local command reads from `op`; a workflow reads from `secrets.*` /
`vars.*`. Don't tell the owner to add a secret to GitHub that a manual command
needs — and vice versa.
