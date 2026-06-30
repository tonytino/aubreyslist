import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import * as guard from "../../.github/scripts/check-hard-rules.mjs";

const {
  checkProcessEnv,
  checkTsDirective,
  checkClientDbImport,
  checkRawApiFetch,
  checkTestHonesty,
  isClientSurface,
} = guard;

// Each matcher returns an array of { line, message }. We assert on length and
// the flagged line so the tests double as documentation of the boundary.

describe("rule #1 — no process.env outside app/env.ts", () => {
  const src = "const x = process.env.DATABASE_URL;\nconst y = 1;\n";

  it("flags process.env in app runtime code", () => {
    const v = checkProcessEnv(src, "app/server/foo.ts");
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
  });

  it("exempts app/env.ts", () => {
    expect(checkProcessEnv(src, "app/env.ts")).toHaveLength(0);
  });

  it("exempts test files", () => {
    expect(checkProcessEnv(src, "app/server/foo.test.ts")).toHaveLength(0);
  });

  it("ignores build tooling outside app/ (scripts, config)", () => {
    expect(checkProcessEnv(src, "scripts/seed.ts")).toHaveLength(0);
    expect(checkProcessEnv(src, "drizzle.config.ts")).toHaveLength(0);
  });
});

describe("rule #2 — no unexplained @ts-ignore / @ts-expect-error", () => {
  it("flags a bare @ts-expect-error", () => {
    const v = checkTsDirective("// @ts-expect-error\nconst x = 1;\n", "app/x.ts");
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
  });

  it("flags a bare @ts-ignore", () => {
    expect(checkTsDirective("// @ts-ignore\n", "db/x.ts")).toHaveLength(1);
  });

  it("flags @ts-expect-error followed by only dashes/punctuation", () => {
    expect(checkTsDirective("// @ts-expect-error --\n", "tests/unit/x.ts")).toHaveLength(1);
  });

  it("allows @ts-expect-error with an explanation", () => {
    expect(checkTsDirective("// @ts-expect-error reason here\n", "app/x.ts")).toHaveLength(0);
  });

  it("allows the .mjs-import pattern used in this very repo", () => {
    expect(
      checkTsDirective(
        "// @ts-expect-error — .mjs script, no type declarations\n",
        "tests/unit/x.ts"
      )
    ).toHaveLength(0);
  });

  it("ignores files outside scope", () => {
    expect(checkTsDirective("// @ts-ignore\n", "drizzle.config.ts")).toHaveLength(0);
  });
});

describe("rule #3 — no db value imports in client code", () => {
  it("flags a value import of ~/db in a component", () => {
    const v = checkClientDbImport('import { getDb } from "~/db";\n', "app/components/X.tsx");
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
  });

  it("flags drizzle-orm and neon value imports in a route", () => {
    expect(
      checkClientDbImport('import { eq } from "drizzle-orm";\n', "app/routes/listings.index.tsx")
    ).toHaveLength(1);
    expect(
      checkClientDbImport(
        'import { neon } from "@neondatabase/serverless";\n',
        "app/routes/listings.index.tsx"
      )
    ).toHaveLength(1);
  });

  it("ALLOWS a type-only import from ~/db/schema (the real ListingCard pattern)", () => {
    expect(
      checkClientDbImport(
        'import type { Listing } from "~/db/schema";\n',
        "app/components/listing/ListingCard.tsx"
      )
    ).toHaveLength(0);
  });

  it("does not flag server seams (*.fn.ts, app/server/**, api.$.ts)", () => {
    const valueImport = 'import { getDb } from "~/db";\n';
    expect(checkClientDbImport(valueImport, "app/server/listings/create.ts")).toHaveLength(0);
    expect(checkClientDbImport(valueImport, "app/server/listings/create.fn.ts")).toHaveLength(0);
    expect(checkClientDbImport(valueImport, "app/routes/api.$.ts")).toHaveLength(0);
  });
});

describe("rule #4 — no raw fetch to Hono /api routes from the frontend", () => {
  it("flags raw fetch('/api/...') in a component", () => {
    const v = checkRawApiFetch('await fetch("/api/listings");\n', "app/components/X.tsx");
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
  });

  it("does not flag fetch to a non-/api URL", () => {
    expect(
      checkRawApiFetch('await fetch("https://example.com/data");\n', "app/components/X.tsx")
    ).toHaveLength(0);
  });

  it("does not flag a method call like app.fetch(request) in a server seam", () => {
    expect(checkRawApiFetch("const h = app.fetch(request);\n", "app/routes/api.$.ts")).toHaveLength(
      0
    );
  });

  it("does not flag fetch in non-client-surface files", () => {
    expect(checkRawApiFetch('fetch("/api/x");\n', "app/server/x.ts")).toHaveLength(0);
  });
});

describe("rule #5 — test honesty", () => {
  // Build the trigger source at runtime from fragments so this very file does
  // NOT contain a literal focused/skipped/todo modifier call (e.g. the dotted
  // only/skip/todo forms) — otherwise the hard-rules guard would flag its own
  // test fixtures as real focused/skipped tests (a self-referential false
  // positive). The `mk` helper assembles the exact string the matcher sees.
  const dot = ".";
  const mk = (fnName: string, modifier: string, args: string) =>
    `${fnName}${dot}${modifier}(${args});\n`;

  it("flags focused tests (.only) for it / describe / test", () => {
    expect(checkTestHonesty(mk("it", "only", '"a", () => {}'), "app/x.test.ts")).toHaveLength(1);
    expect(
      checkTestHonesty(mk("describe", "only", '"a", () => {}'), "tests/unit/x.test.ts")
    ).toHaveLength(1);
    expect(
      checkTestHonesty(mk("test", "only", '"a", () => {}'), "tests/e2e/x.spec.ts")
    ).toHaveLength(1);
  });

  it("flags a .skip modifier with a string-literal test name", () => {
    expect(checkTestHonesty(mk("it", "skip", '"a", () => {}'), "app/x.test.ts")).toHaveLength(1);
    expect(
      checkTestHonesty(mk("describe", "skip", '"a", () => {}'), "tests/x.test.ts")
    ).toHaveLength(1);
  });

  it("flags .todo", () => {
    expect(checkTestHonesty(mk("it", "todo", '"later"'), "app/x.test.ts")).toHaveLength(1);
    expect(checkTestHonesty(mk("test", "todo", '"later"'), "tests/x.test.ts")).toHaveLength(1);
  });

  it("ALLOWS the conditional Playwright skip test.skip(cond, reason)", () => {
    expect(
      checkTestHonesty(mk("test", "skip", '!E2E_DB_READY, "needs DB"'), "tests/e2e/sign-in.spec.ts")
    ).toHaveLength(0);
  });

  it("ALLOWS Vitest describe.skipIf(cond)", () => {
    expect(
      checkTestHonesty(
        `describe${dot}skipIf(!hasDb)("x", () => {});\n`,
        "tests/integration/x.test.ts"
      )
    ).toHaveLength(0);
  });

  it("ignores non-test files", () => {
    expect(
      checkTestHonesty(mk("it", "only", '"a", () => {}'), "app/components/X.tsx")
    ).toHaveLength(0);
  });
});

describe("isClientSurface boundary", () => {
  it("treats components and routes as client surface", () => {
    expect(isClientSurface("app/components/X.tsx")).toBe(true);
    expect(isClientSurface("app/routes/index.tsx")).toBe(true);
  });

  it("excludes server seams and tests", () => {
    expect(isClientSurface("app/server/x.ts")).toBe(false);
    expect(isClientSurface("app/routes/api.$.ts")).toBe(false);
    expect(isClientSurface("app/components/X.fn.ts")).toBe(false);
    expect(isClientSurface("app/components/X.test.tsx")).toBe(false);
    expect(isClientSurface("db/schema.ts")).toBe(false);
  });
});
