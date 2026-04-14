# Environment Variables

All environment variables are validated at startup using Zod in `app/env.ts`.

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

3. Import `env` from `~/env` wherever you need it — never use `process.env` directly:

```ts
import { env } from "~/env";
console.log(env.YOUR_NEW_VAR);
```

## Rules

- Never access `process.env` directly outside of `app/env.ts`.
- Never commit `.env`. It is gitignored.
- Always keep `.env.example` in sync with `app/env.ts`.
- In CI, secrets are injected via GitHub Actions secrets — see `.github/workflows/ci.yml`.
