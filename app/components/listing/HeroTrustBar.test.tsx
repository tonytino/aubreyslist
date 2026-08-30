import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SafetyState } from "~/components/SafetySignal";
import { deriveListingActivityMeta } from "~/trust/summary";
import { HeroTrustBar } from "./HeroTrustBar";

/**
 * The hero bar's structural contract.
 *
 * The bug these pin: the verdict and the activity strip were siblings in a
 * wrapping, centred row, so the strip's resting position depended on what the
 * verdict rendered next to it — a ~100px badge chip in one state, a
 * `max-w-prose` paragraph in another. The strip appeared in a visibly different
 * place on a badged listing than on an unbadged one.
 *
 * So these tests assert POSITION, not appearance: same parent, same index, same
 * classes, in every hero state. A future conditional that moves the strip — or
 * gives it a state-dependent margin — has to break one of these.
 */

const ACTIVE = deriveListingActivityMeta({
  lastActivityAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  happyPatrons: 4,
});

/** The four hero states, by what `SafetySummary` renders in each. */
const HERO_STATES: Array<{
  name: string;
  safetyState: SafetyState | null;
  hasRecentIncident: boolean;
}> = [
  { name: "celiac-safe badge", safetyState: "celiac-safe", hasRecentIncident: false },
  { name: "stale badge", safetyState: "stale", hasRecentIncident: false },
  {
    name: "celiac-safe badge + incident chip",
    safetyState: "celiac-safe",
    hasRecentIncident: true,
  },
  { name: "incident chip + guidance", safetyState: null, hasRecentIncident: true },
  { name: "guidance prose only", safetyState: null, hasRecentIncident: false },
];

function renderBar(safetyState: SafetyState | null, hasRecentIncident: boolean) {
  return render(
    <HeroTrustBar
      safetyState={safetyState}
      hasRecentIncident={hasRecentIncident}
      activity={ACTIVE}
    />
  );
}

describe("HeroTrustBar — the activity strip's fixed slot", () => {
  it.each(HERO_STATES)(
    "puts the strip second under the bar, every time ($name)",
    ({ safetyState, hasRecentIncident }) => {
      renderBar(safetyState, hasRecentIncident);

      const bar = screen.getByTestId("hero-trust-bar");
      const strip = screen.getByTestId("hero-activity");

      // Same parent, same index — not "somewhere inside", which a wrap row
      // would also satisfy while moving the strip visually.
      expect(strip.parentElement).toBe(bar);
      expect(bar.children).toHaveLength(2);
      expect(bar.children[1]).toBe(strip);
      // …and the verdict is always the row above it.
      expect(bar.children[0]?.tagName).toBe("SECTION");
    }
  );

  it("gives the strip identical classes in all four states (no state-dependent margin)", () => {
    const seen = new Set<string>();
    for (const { safetyState, hasRecentIncident } of HERO_STATES) {
      const { unmount } = renderBar(safetyState, hasRecentIncident);
      seen.add(screen.getByTestId("hero-activity").className);
      unmount();
    }
    // One class string across every state: spacing comes from the container's
    // gap alone, never from a margin that appears with a badge or with prose.
    expect(seen.size).toBe(1);
  });

  it("keeps the bar a COLUMN in all four states, so the strip never shares a row", () => {
    // The regression was a wrapping row (`flex-wrap … justify-between`), where
    // the strip sat beside a chip in one state and below a paragraph in
    // another. A column has one slot per child at every width.
    const seen = new Set<string>();
    for (const { safetyState, hasRecentIncident } of HERO_STATES) {
      const { unmount } = renderBar(safetyState, hasRecentIncident);
      const bar = screen.getByTestId("hero-trust-bar");
      expect(bar.className).toContain("flex-col");
      expect(bar.className).not.toContain("flex-wrap");
      expect(bar.className).not.toContain("justify-between");
      seen.add(bar.className);
      unmount();
    }
    expect(seen.size).toBe(1);
  });

  it("renders the strip's content in every state, including with no activity", () => {
    for (const { name, safetyState, hasRecentIncident } of HERO_STATES) {
      const { unmount } = renderBar(safetyState, hasRecentIncident);
      expect(screen.getByTestId("activity-line"), name).toHaveTextContent("Updated 3 days ago");
      expect(screen.getByTestId("happy-patrons"), name).toHaveTextContent("4 happy patrons");
      unmount();
    }

    // The honest empty state occupies the same slot rather than collapsing it.
    render(
      <HeroTrustBar
        safetyState={null}
        hasRecentIncident={false}
        activity={deriveListingActivityMeta(null)}
      />
    );
    const bar = screen.getByTestId("hero-trust-bar");
    expect(bar.children).toHaveLength(2);
    expect(bar.children[1]).toBe(screen.getByTestId("hero-activity"));
    expect(screen.getByTestId("activity-line")).toHaveTextContent("No activity yet");
    expect(screen.queryByTestId("happy-patrons")).not.toBeInTheDocument();
  });
});

describe("HeroTrustBar — the verdict row it wraps", () => {
  it("shows the badge and no guidance when there is a verdict", () => {
    renderBar("celiac-safe", false);
    expect(screen.getByText("Celiac-safe")).toBeInTheDocument();
    expect(screen.queryByTestId("safety-summary-guidance")).not.toBeInTheDocument();
  });

  it("shows guidance and no safety badge when there is no verdict", () => {
    renderBar(null, false);
    expect(screen.getByTestId("safety-summary-guidance")).toHaveTextContent(
      "This restaurant isn't confirmed celiac-safe."
    );
    expect(document.querySelector("[data-safety-state]")).not.toBeInTheDocument();
  });

  it("shows the incident chip above the guidance when harm is on file with no verdict", () => {
    renderBar(null, true);
    expect(screen.getByText("Recent incident")).toBeInTheDocument();
    expect(screen.getByTestId("safety-summary-guidance")).toBeInTheDocument();
    // The strip still sits below BOTH, in its one slot.
    const bar = screen.getByTestId("hero-trust-bar");
    expect(bar.children[1]).toBe(screen.getByTestId("hero-activity"));
  });

  it("keeps activity OUT of the safety section (ADR-007: it is not a safety cue)", () => {
    renderBar("celiac-safe", false);
    const section = screen.getByTestId("hero-trust-bar").children[0] as HTMLElement;
    expect(section).not.toContainElement(screen.getByTestId("hero-activity"));
  });
});
