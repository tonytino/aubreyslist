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

Use `getByRole`, `getByLabelText`, `getByText` — avoid `getByTestId` unless no semantic alternative exists.

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

> Playwright's dev server (`playwright.config.ts`) runs `pnpm dev`, so it does
> not exercise the production build. CI has a separate **Production build smoke**
> job (`.github/workflows/ci.yml`) that runs `pnpm build && pnpm start` and
> asserts the homepage and its stylesheet asset resolve — this catches
> build-only breakage (e.g. an asset referenced by source path) that `pnpm dev`
> hides. It needs no database.

### DB-touching E2E tests must clean up after themselves

CI applies migrations (`pnpm db:migrate`) before the Playwright steps, gated on
the `CI_E2E_DATABASE_URL` secret. **That CI Neon branch is persistent — state
accumulates across runs.** There is no per-run reset, so any E2E test that
writes to the database must manage its own data:

- Use **unique per-run identifiers** (e.g. suffix emails / names with a random
  token or timestamp) so concurrent or repeated runs never collide on unique
  constraints (`users.email`, `users.google_sub`, `listings.place_id`, …).
- **Clean up what you create** (delete rows in an `afterEach`/`afterAll`, or
  scope assertions to your unique identifier) so the branch doesn't fill with
  orphaned fixtures.
- Never assume an empty database or a fixed row count.

## Coverage Requirements

| What you add              | What you must test                        |
| ------------------------- | ----------------------------------------- |
| Utility function          | Vitest unit test (co-located)             |
| New route                 | Playwright smoke test                     |
| Component with logic      | Vitest component test                     |
| Hono route                | Vitest unit test for the handler          |
