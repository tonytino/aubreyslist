import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  callsAuthGuard,
  createServerFnCallCount,
  postServerFnExports,
  serverFnExports,
  toPosix,
  walkFnFiles,
} from "./server-fn-post-guards.helpers";

/**
 * Static-analysis guard test: every POST `createServerFn` server
 * function under `app/server/**` must call an auth guard from
 * `app/server/auth/guards.ts` (`requireCurrentUser` / `requireCurrentRole`, or
 * their synchronous counterparts `requireUser` / `requireRole`) — the
 * open-read / gated-write rule documented in that module's header (ADR-010).
 *
 * This is a heuristic text scan, mirroring the established pattern in
 * `.github/scripts/check-hard-rules.mjs` / `tests/unit/hard-rules-guard.test.ts`
 * — it does not execute or type-check the source, and it does not strip out
 * comments/string literals. Two things make a plain "grep the file" too naive
 * for this repo's actual convention, so the scan (in
 * `server-fn-post-guards.helpers.ts`) resolves one hop of local imports:
 *
 *   1. Several `*.fn.ts` files call the guard directly inside the handler
 *      (`app/server/listings/create.fn.ts`, `app/server/places.fn.ts`), via a
 *      lazy `import("~/server/auth/guards")` so the guard's `db`-bound
 *      transitive deps stay out of the client bundle.
 *   2. Most others delegate the entire write to a sibling implementation
 *      module (`./index`, `./actions`, `./set-role`, `./set-intake-mode`,
 *      ...) — same bundle-hygiene reason — and that module calls the guard.
 *      (See `app/server/admin/set-role.fn.ts` -> `./set-role.ts`,
 *      `app/server/moderation/actions.fn.ts` -> `./actions.ts`, etc.)
 *
 * Resolving one hop of `./...`/`~/...` imports covers every server fn in
 * this repo. A handler that needs a second hop to reach its guard call would
 * need this scan extended — more likely, that is itself a sign the seam
 * should be flattened one level.
 *
 * ---- Exceptions -----------------------------------------------------------
 * A POST server fn that is intentionally not guarded (e.g. a public write
 * with its own bespoke protection, such as rate-limiting alone) must be added
 * to `EXCEPTIONS` below with a real, reviewable reason — an empty reason
 * fails the "every exception is documented" test, so a silent/undocumented
 * exemption is not possible; a reviewer sees the reason in the diff. There
 * are none today: every POST server fn in this repo is guarded.
 */

const ROOT = resolve(import.meta.dirname, "..", "..");
const SERVER_DIR = join(ROOT, "app", "server");

/**
 * Explicit, documented exceptions to "every POST server fn is guarded". Key =
 * repo-relative POSIX path of the `*.fn.ts` file; value = the reason it's
 * exempt. Add an entry here (with a real reason) rather than weakening the
 * scan/regex in `server-fn-post-guards.helpers.ts` if a future POST fn is
 * legitimately ungated.
 */
const EXCEPTIONS: Record<string, string> = {};

const fnFiles = walkFnFiles(SERVER_DIR).sort();

describe("AUB-186 — every POST server function is guarded", () => {
  // Canary: fail loudly — rather than silently passing an empty suite — if the
  // filesystem walk stops finding *.fn.ts files, or the POST regex stops
  // matching this repo's `createServerFn({ method: "POST" })` call shape.
  it("discovers at least one *.fn.ts file with a POST export (sanity check on the scan itself)", () => {
    const anyPost = fnFiles.some((f) => postServerFnExports(readFileSync(f, "utf8")).length > 0);
    expect(anyPost).toBe(true);
  });

  // Cross-check canary: every raw `createServerFn(` call site in a *.fn.ts
  // file must be picked up by `serverFnExports` as an `export const NAME =
  // createServerFn(...)` with a resolvable `method:` — so if a future call
  // shape appears that the scanner can't parse (e.g. it's not assigned via
  // `export const`, or the options argument isn't a plain object literal),
  // this fails loudly instead of the fn just silently vanishing from the
  // POST-guard scan below.
  for (const fileAbs of fnFiles) {
    const relPath = toPosix(relative(ROOT, fileAbs));
    it(`${relPath}: every createServerFn( call site is parsed with a resolvable method`, () => {
      const source = readFileSync(fileAbs, "utf8");
      const callSiteCount = createServerFnCallCount(source);
      const exports = serverFnExports(source);
      expect(
        exports.length,
        `${relPath} has ${callSiteCount} createServerFn( call site(s) but the scanner only parsed ${exports.length} as \`export const NAME = createServerFn(...)\` — a call shape here isn't recognized by serverFnExports in server-fn-post-guards.helpers.ts.`
      ).toBe(callSiteCount);
      for (const e of exports) {
        expect(
          e.method,
          `${relPath}::${e.name}'s createServerFn(...) options object has no parsable \`method: "..."\` property.`
        ).not.toBeNull();
      }
    });
  }

  for (const fileAbs of fnFiles) {
    const relPath = toPosix(relative(ROOT, fileAbs));
    const source = readFileSync(fileAbs, "utf8");
    const postExports = postServerFnExports(source);
    if (postExports.length === 0) continue;

    describe(relPath, () => {
      for (const name of postExports) {
        it(`${name} calls an auth guard (or is a documented exception)`, () => {
          const exceptionReason = EXCEPTIONS[relPath];
          if (exceptionReason !== undefined) {
            expect(exceptionReason.trim().length).toBeGreaterThan(0);
            return;
          }
          expect(
            callsAuthGuard(fileAbs, source, ROOT),
            `${relPath}::${name} is a POST server fn with no requireCurrentUser/requireCurrentRole call reachable within one import hop, and is not in the documented EXCEPTIONS list in tests/unit/server-fn-post-guards.test.ts. Guard it (see app/server/auth/guards.ts) or add a reviewed exception with a reason.`
          ).toBe(true);
        });
      }
    });
  }

  it("every documented exception carries a non-empty, reviewable reason", () => {
    for (const [file, reason] of Object.entries(EXCEPTIONS)) {
      expect(typeof reason, file).toBe("string");
      expect(reason.trim().length, file).toBeGreaterThan(0);
    }
  });
});

describe("detector unit tests — postServerFnExports / callsAuthGuard", () => {
  it("postServerFnExports finds POST exports and ignores GET exports", () => {
    const src = `
      export const readThing = createServerFn({ method: "GET" }).handler(() => null);
      export const writeThing = createServerFn({ method: "POST" }).handler(() => null);
      export const writeOther = createServerFn({ method: "POST" })
        .validator(schema)
        .handler(() => null);
    `;
    expect(postServerFnExports(src)).toEqual(["writeThing", "writeOther"]);
  });

  it("finds a POST export whose options object has extra properties alongside method (regression)", () => {
    const src = `
      export const writeThing = createServerFn({ method: "POST", strict: false }).handler(() => null);
    `;
    expect(postServerFnExports(src)).toEqual(["writeThing"]);
  });

  it("finds a POST export in a multi-line options object with a trailing comma, e.g. Biome es5 output (regression)", () => {
    const src = `
      export const writeThing = createServerFn({
        method: "POST",
        strict: false,
      }).handler(() => null);
    `;
    expect(postServerFnExports(src)).toEqual(["writeThing"]);
  });

  it("finds a POST export in a single-property multi-line options object with a trailing comma (regression)", () => {
    // What Biome's `trailingCommas: "es5"` rewrites even a single-property
    // `createServerFn({ method: "POST" })` into once it's reformatted across
    // lines (e.g. because a line got long) — must not silently drop the fn.
    const src = `
      export const writeThing = createServerFn({
        method: "POST",
      }).handler(() => null);
    `;
    expect(postServerFnExports(src)).toEqual(["writeThing"]);
  });

  it("serverFnExports reports method: null for a call it can't parse the method out of", () => {
    const src = `
      export const writeThing = createServerFn(someDynamicOptions).handler(() => null);
    `;
    expect(serverFnExports(src)).toEqual([{ name: "writeThing", method: null }]);
  });

  it("createServerFnCallCount counts every call site regardless of assignment shape", () => {
    const src = `
      export const a = createServerFn({ method: "GET" }).handler(() => null);
      const b = createServerFn({ method: "POST" }).handler(() => null);
    `;
    expect(createServerFnCallCount(src)).toBe(2);
    expect(serverFnExports(src)).toEqual([{ name: "a", method: "GET" }]);
  });

  it("createServerFnCallCount ignores a doc comment that mentions createServerFn(...) in prose (regression, from app/server/flags/flags.fn.ts)", () => {
    const src = `
      /**
       * The \`createServerFn().validator(schema)\` boundary IS the authoritative check.
       */
      export const writeThing = createServerFn({ method: "POST" }).handler(() => null);
    `;
    expect(createServerFnCallCount(src)).toBe(1);
    expect(serverFnExports(src)).toEqual([{ name: "writeThing", method: "POST" }]);
  });

  it("detects a direct requireCurrentUser() call inside the fn file itself", () => {
    const src = `
      export const doThing = createServerFn({ method: "POST" }).handler(async () => {
        const { requireCurrentUser } = await import("~/server/auth/guards");
        await requireCurrentUser();
      });
    `;
    expect(callsAuthGuard(join(SERVER_DIR, "fixture.fn.ts"), src, ROOT)).toBe(true);
  });

  it("does NOT accept a guard that is only mentioned in a comment (soundness regression, AUB-186 review)", () => {
    const src = `
      /**
       * Callers must hold a session — see requireCurrentUser() in the guards module.
       */
      // TODO: call requireCurrentUser() here
      export const doThing = createServerFn({ method: "POST" }).handler(async () => null);
    `;
    expect(callsAuthGuard(join(SERVER_DIR, "fixture.fn.ts"), src, ROOT)).toBe(false);
  });

  describe("one-hop resolution through a relative import (the ./actions / ./index seam)", () => {
    const dir = mkdtempSync(join(tmpdir(), "aub-186-guard-test-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("follows a relative import to a module that DOES call the guard", () => {
      writeFileSync(
        join(dir, "impl.ts"),
        `import { requireCurrentRole } from "~/server/auth/guards";
export async function doWrite() {
  await requireCurrentRole("moderator");
}
`
      );
      const fnSource = `import { createServerFn } from "@tanstack/react-start";
export const writeThing = createServerFn({ method: "POST" }).handler(async () => {
  const { doWrite } = await import("./impl");
  return doWrite();
});
`;
      expect(callsAuthGuard(join(dir, "thing.fn.ts"), fnSource, ROOT)).toBe(true);
    });

    it("correctly reports FALSE when the delegated module has no guard call (regression case)", () => {
      writeFileSync(
        join(dir, "unguarded.ts"),
        `export async function doWrite(data: unknown) {
  return data;
}
`
      );
      const fnSource = `import { createServerFn } from "@tanstack/react-start";
export const writeThing = createServerFn({ method: "POST" }).handler(async () => {
  const { doWrite } = await import("./unguarded");
  return doWrite();
});
`;
      // The case the guard suite above exists to catch: an unguarded POST
      // server fn must be detected as such, not silently pass.
      expect(callsAuthGuard(join(dir, "thing.fn.ts"), fnSource, ROOT)).toBe(false);
    });

    it("returns false when the fn file has no guard call and no local imports at all", () => {
      const fnSource = `import { createServerFn } from "@tanstack/react-start";
export const writeThing = createServerFn({ method: "POST" }).handler(() => "ok");
`;
      expect(callsAuthGuard(join(dir, "thing.fn.ts"), fnSource, ROOT)).toBe(false);
    });
  });
});
