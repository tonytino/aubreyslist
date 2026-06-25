import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import * as changelog from "../../scripts/changelog.mjs";

const {
  bulletsOf,
  groupByCategory,
  insertReleaseSection,
  parseFragmentName,
  renderSection,
  validateFragment,
} = changelog;

describe("parseFragmentName", () => {
  it("splits slug and category", () => {
    expect(parseFragmentName("42-unused-deps.changed.md")).toEqual({
      slug: "42-unused-deps",
      category: "changed",
    });
  });

  it("rejects an unknown category", () => {
    expect(() => parseFragmentName("foo.bogus.md")).toThrow(/unknown category/);
  });

  it("rejects a malformed name", () => {
    expect(() => parseFragmentName("foo.md")).toThrow(/<slug>\.<category>\.md/);
  });
});

describe("validateFragment", () => {
  it("accepts a tagged bullet", () => {
    expect(validateFragment("1-x.added.md", "- `[propagate]` Did a thing.\n")).toEqual([]);
  });

  it("flags a bullet with no propagation tag", () => {
    const errors = validateFragment("1-x.added.md", "- Did a thing.");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no `\[propagate\]`/);
  });

  it("flags a non-bullet line", () => {
    const errors = validateFragment("1-x.added.md", "Did a thing.");
    expect(errors[0]).toMatch(/not a Markdown bullet/);
  });

  it("flags an empty fragment", () => {
    expect(validateFragment("1-x.added.md", "\n\n")).toEqual([
      "1-x.added.md: no entries (file is empty)",
    ]);
  });

  it("flags a bad filename", () => {
    expect(validateFragment("oops.md", "- `[propagate]` x")[0]).toMatch(/<slug>\.<category>\.md/);
  });
});

describe("bulletsOf", () => {
  it("drops blank lines and trailing whitespace", () => {
    expect(bulletsOf("- a  \n\n- b\n")).toEqual(["- a", "- b"]);
  });
});

describe("groupByCategory + renderSection", () => {
  it("renders categories in canonical order and skips empties", () => {
    const grouped = groupByCategory([
      { category: "fixed", bullets: ["- `[template-only]` fix"] },
      { category: "added", bullets: ["- `[propagate]` add"] },
    ]);
    const out = renderSection("## [Unreleased]", grouped);
    expect(out).toBe(
      "## [Unreleased]\n\n### Added\n\n- `[propagate]` add\n\n### Fixed\n\n- `[template-only]` fix\n"
    );
    expect(out.indexOf("### Added")).toBeLessThan(out.indexOf("### Fixed"));
    expect(out).not.toContain("### Changed");
  });
});

describe("insertReleaseSection", () => {
  it("inserts the new section above the most recent version", () => {
    const changelogText = [
      "## [Unreleased]",
      "",
      "---",
      "",
      "## [0.2.0] - 2026-04-21",
      "",
      "x",
    ].join("\n");
    const section = "## [0.3.0] - 2026-06-25\n\n### Added\n\n- `[propagate]` new\n";
    const out = insertReleaseSection(changelogText, section);
    expect(out.indexOf("## [0.3.0]")).toBeLessThan(out.indexOf("## [0.2.0]"));
    expect(out.indexOf("## [Unreleased]")).toBeLessThan(out.indexOf("## [0.3.0]"));
    expect(out).toContain("- `[propagate]` new");
  });
});
