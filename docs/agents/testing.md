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

## Coverage Requirements

| What you add              | What you must test                        |
| ------------------------- | ----------------------------------------- |
| Utility function          | Vitest unit test (co-located)             |
| New route                 | Playwright smoke test                     |
| Component with logic      | Vitest component test                     |
| Hono route                | Vitest unit test for the handler          |
