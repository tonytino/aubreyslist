# Testing

Two tools: Vitest (unit/component) and Playwright (E2E).

## Vitest — Unit & Component Tests

### Where tests live
- Co-locate with source: `app/utils/format.ts` → `app/utils/format.test.ts`
- Component tests: `app/components/Button.tsx` → `app/components/Button.test.tsx`
- Non-co-located tests (rare): `tests/unit/`

### Writing tests

```ts
// app/utils/format.test.ts
import { describe, expect, it } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  it("formats a date correctly", () => {
    expect(formatDate(new Date("2024-01-15"))).toBe("Jan 15, 2024");
  });
});
```

### Component tests

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders label", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });
});
```

Use `getByRole`, `getByLabelText`, `getByText` — avoid `getByTestId` unless no
semantic alternative exists.

### Commands
```bash
pnpm test         # Watch mode
pnpm test:ui      # Browser UI
```

## Playwright — E2E Tests

### Where tests live
`tests/e2e/` — one file per route or feature area.

### Writing tests

```ts
// tests/e2e/posts.spec.ts
import { expect, test } from "@playwright/test";

test("posts page shows list", async ({ page }) => {
  await page.goto("/posts");
  await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible();
});
```

### Commands
```bash
pnpm test:e2e        # Headless
pnpm test:e2e:ui     # Interactive UI (good for debugging)
```

> Playwright's dev server (`playwright.config.ts`) runs `pnpm dev`, so it never
> exercises the production build. CI's separate **Production build smoke** job
> (`.github/workflows/ci.yml`) runs `pnpm build && pnpm start` and asserts the
> homepage and its stylesheet asset resolve — catching build-only breakage that
> `pnpm dev` hides. It needs no database.

### DB-touching E2E tests must clean up after themselves

CI applies migrations (`pnpm db:migrate`) before the Playwright steps, gated on
the `CI_E2E_DATABASE_URL` secret. **That CI Neon branch is persistent — state
accumulates across runs.** Any E2E test that writes to the database must manage
its own data:

- Use **unique per-run identifiers** (e.g. suffix emails / names with a random
  token or timestamp) so concurrent or repeated runs never collide on unique
  constraints (`users.email`, `users.google_sub`, `listings.place_id`, …).
- **Clean up what you create** (delete rows in an `afterEach`/`afterAll`, or
  scope assertions to your unique identifier).
- Never assume an empty database or a fixed row count.

**One carve-out: the curated seed dataset.** The baked set in
`scripts/seed-data.ts` is standing, intentional data every environment carries.
`tests/e2e/seeded-listings.spec.ts` seeds it idempotently (Place-ID dedup on
listings, `onConflictDoNothing` on claims) via `scripts/seed.ts`'s
`seedListings` core, and deliberately never deletes it. The exemption covers
only those baked rows — everything else a spec creates (users, listings, claims,
settings) follows the rules above.

### Authenticated + DB-seeded E2E (the shared fixtures)

`tests/e2e/fixtures.ts` is the one place to seed data and establish an
authenticated session in an E2E spec. Reuse it — do not invent a new mechanism.

- **Auth ("mocked sign-in").** The session is a sealed, server-signed cookie
  (ADR-006) — there is **no `sessions` table** — so a spec signs a user in by
  minting that cookie with the repo's own `sealSessionPayload` and adding it to
  the browser context (`Seeder.signIn`). Same seal the Google OAuth callback
  writes, so the dev server unseals + re-reads the live `users` row via
  `getCurrentUser` exactly as in production. No real OAuth round-trip, no bypass
  endpoint.
- **Seeding.** `Seeder` inserts users/listings/claims/attestations/incidents and
  the `intake_mode` setting via Drizzle (Neon HTTP), each keyed on a unique
  per-run token, and tracks every row so `Seeder.cleanup()` removes them (a
  listing cascades to its children). Force `intake_mode = manual` for the
  deterministic, Places-key-free add-listing form.
- **Gating.** Minting the cookie and seeding need `DATABASE_URL` **and**
  `SESSION_SECRET`. When either is absent, gate the spec on `E2E_DB_READY` with
  `test.skip(!E2E_DB_READY, …)` so it skips rather than fails. CI supplies
  `SESSION_SECRET` to the E2E step alongside `DATABASE_URL`.

These specs cannot run without a backend + seeded Postgres; validate them with
`pnpm preflight` (typechecks the specs) and `pnpm build`, then let CI run them.

## Coverage Requirements

| What you add              | What you must test                        |
| ------------------------- | ----------------------------------------- |
| Utility function          | Vitest unit test (co-located)             |
| New route                 | Playwright smoke test                     |
| Component with logic      | Vitest component test                     |
| Hono route                | Vitest unit test for the handler          |
