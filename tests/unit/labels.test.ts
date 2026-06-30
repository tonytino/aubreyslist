import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs script, no type declarations
import * as labels from "../../scripts/labels.mjs";

/** @type {{ name: string; color: string; description: string }[]} */
const { LABELS } = labels;

// The complete, canonical set of label names the workflow defines. Keep this in
// sync with scripts/labels.mjs and the Label Reference in docs/agents/tasks.md.
const EXPECTED_LABELS = [
  "status:ready",
  "status:in-progress",
  "status:blocked",
  "status:needs-review",
  "type:bug",
  "type:feature",
  "type:chore",
  "type:docs",
  "type:epic",
  "size:xs",
  "size:s",
  "size:m",
  "size:l",
  "safe:agent",
  "safe:human",
  "skip-changelog",
];

describe("LABELS", () => {
  it("defines exactly the expected set of labels", () => {
    const names = LABELS.map((l: { name: string }) => l.name);
    expect(new Set(names)).toEqual(new Set(EXPECTED_LABELS));
    // No duplicates.
    expect(names).toHaveLength(EXPECTED_LABELS.length);
  });

  it("includes the type:epic label with a distinct color", () => {
    const epic = LABELS.find((l: { name: string }) => l.name === "type:epic");
    expect(epic).toBeDefined();
    expect(epic.description).toMatch(/epic/i);

    // type:epic must be visually distinguishable from the other type:* labels.
    const otherTypeColors = LABELS.filter(
      (l: { name: string }) => l.name.startsWith("type:") && l.name !== "type:epic"
    ).map((l: { color: string }) => l.color);
    expect(otherTypeColors).not.toContain(epic.color);
  });

  it("gives every label a 6-digit hex color and a non-empty description", () => {
    for (const label of LABELS) {
      expect(label.name, "label has a name").toBeTruthy();
      expect(label.color, `${label.name} color is 6-digit hex`).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description.trim().length, `${label.name} has a description`).toBeGreaterThan(0);
    }
  });
});
