import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import * as licenses from "../../.github/scripts/check-licenses.mjs";

const { isAllowedLicense, isReviewedException, findViolations, ALLOWLIST, REVIEWED_EXCEPTIONS } =
  licenses;

describe("isAllowedLicense — permissive allowlist predicate", () => {
  it("allows the core permissive SPDX ids", () => {
    for (const id of [
      "MIT",
      "ISC",
      "Apache-2.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "0BSD",
      "CC0-1.0",
      "Unlicense",
      "Python-2.0",
      "BlueOak-1.0.0",
      "CC-BY-4.0",
      "MIT-0",
    ]) {
      expect(isAllowedLicense(id), id).toBe(true);
    }
  });

  it("rejects copyleft and weak-copyleft ids", () => {
    for (const id of ["GPL-2.0", "GPL-3.0", "LGPL-3.0", "AGPL-3.0", "MPL-2.0", "EPL-2.0"]) {
      expect(isAllowedLicense(id), id).toBe(false);
    }
  });

  it("is case-insensitive on the SPDX id", () => {
    expect(isAllowedLicense("mit")).toBe(true);
    expect(isAllowedLicense("apache-2.0")).toBe(true);
  });

  it("OR — allows when EITHER operand is permissive (consumer picks the allowed side)", () => {
    expect(isAllowedLicense("MIT OR Apache-2.0")).toBe(true);
    // node-forge's real expression: GPL side is disallowed, BSD side is allowed.
    expect(isAllowedLicense("(BSD-3-Clause OR GPL-2.0)")).toBe(true);
    expect(isAllowedLicense("GPL-3.0 OR LGPL-3.0")).toBe(false);
  });

  it("AND — requires EVERY operand to be permissive", () => {
    expect(isAllowedLicense("MIT AND ISC")).toBe(true);
    expect(isAllowedLicense("MIT AND GPL-3.0")).toBe(false);
  });

  it("handles nested parentheses", () => {
    expect(isAllowedLicense("(MIT OR (Apache-2.0 AND ISC))")).toBe(true);
    expect(isAllowedLicense("(GPL-3.0 AND (MIT OR ISC))")).toBe(false);
  });

  it("ignores a trailing WITH <exception> clause (judges the base license)", () => {
    expect(isAllowedLicense("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(isAllowedLicense("GPL-3.0 WITH Classpath-exception-2.0")).toBe(false);
  });

  it("fails closed on empty / unknown / non-string input", () => {
    expect(isAllowedLicense("")).toBe(false);
    expect(isAllowedLicense("   ")).toBe(false);
    expect(isAllowedLicense("UNKNOWN")).toBe(false);
    // Runtime guard against non-strings (the .mjs import is untyped here).
    expect(isAllowedLicense(null)).toBe(false);
    expect(isAllowedLicense(undefined)).toBe(false);
  });

  it("respects a custom allowlist argument", () => {
    const custom = new Set(["mpl-2.0"]);
    expect(isAllowedLicense("MPL-2.0", custom)).toBe(true);
    expect(isAllowedLicense("MIT", custom)).toBe(false);
  });
});

describe("isReviewedException — package-scoped exceptions", () => {
  it("matches a reviewed package+license pair", () => {
    expect(isReviewedException("lightningcss", "MPL-2.0")).toBe(true);
  });

  it("does not match a different package under the same license", () => {
    expect(isReviewedException("some-other-pkg", "MPL-2.0")).toBe(false);
  });

  it("does not match the reviewed package under a different license", () => {
    expect(isReviewedException("lightningcss", "GPL-3.0")).toBe(false);
  });

  it("every reviewed exception carries a written rationale", () => {
    for (const e of REVIEWED_EXCEPTIONS) {
      expect(typeof e.reason).toBe("string");
      expect(e.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("findViolations — over parsed `pnpm licenses list --json` data", () => {
  it("flags a disallowed (GPL) package", () => {
    const data = {
      "GPL-3.0": [{ name: "evil-lib", versions: ["1.0.0"], license: "GPL-3.0" }],
    };
    const v = findViolations(data);
    expect(v).toEqual([{ name: "evil-lib", version: "1.0.0", license: "GPL-3.0" }]);
  });

  it("passes a tree of only permissive licenses", () => {
    const data = {
      MIT: [{ name: "a", versions: ["1.0.0"], license: "MIT" }],
      "Apache-2.0": [{ name: "b", versions: ["2.0.0"], license: "Apache-2.0" }],
      "(BSD-3-Clause OR GPL-2.0)": [
        { name: "node-forge", versions: ["1.4.0"], license: "(BSD-3-Clause OR GPL-2.0)" },
      ],
    };
    expect(findViolations(data)).toEqual([]);
  });

  it("does not flag a reviewed exception (lightningcss/MPL-2.0) but DOES flag an unreviewed MPL package", () => {
    const data = {
      "MPL-2.0": [
        { name: "lightningcss", versions: ["1.32.0"], license: "MPL-2.0" },
        { name: "random-mpl-pkg", versions: ["3.0.0"], license: "MPL-2.0" },
      ],
    };
    const v = findViolations(data);
    expect(v).toEqual([{ name: "random-mpl-pkg", version: "3.0.0", license: "MPL-2.0" }]);
  });

  it("returns violations sorted by name for stable output", () => {
    const data = {
      "GPL-3.0": [
        { name: "zlib-thing", versions: ["1.0.0"], license: "GPL-3.0" },
        { name: "alpha-thing", versions: ["1.0.0"], license: "GPL-3.0" },
      ],
    };
    expect(findViolations(data).map((x: { name: string }) => x.name)).toEqual([
      "alpha-thing",
      "zlib-thing",
    ]);
  });
});

describe("ALLOWLIST sanity", () => {
  it("contains only lowercased ids (matched case-insensitively)", () => {
    for (const id of ALLOWLIST) {
      expect(id).toBe(id.toLowerCase());
    }
  });

  it("does not contain copyleft families", () => {
    for (const id of ["gpl-2.0", "gpl-3.0", "lgpl-3.0", "agpl-3.0", "mpl-2.0"]) {
      expect(ALLOWLIST.has(id)).toBe(false);
    }
  });
});
