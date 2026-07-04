import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { safetyLabel } from "~/components/SafetySignal";
import { SafetySummary } from "./SafetySummary";

describe("SafetySummary", () => {
  it("renders an honest empty state when no trust data exists (no fabricated rating)", () => {
    render(<SafetySummary state={null} />);
    expect(screen.getByText("Not yet attested")).toBeInTheDocument();
    // The empty state must not claim a celiac-safe / gluten-friendly verdict.
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
    expect(screen.queryByText("Gluten-friendly")).not.toBeInTheDocument();
  });

  it("treats undefined state the same as null (empty state)", () => {
    render(<SafetySummary />);
    expect(screen.getByText("Not yet attested")).toBeInTheDocument();
  });

  it("renders the accessible SafetySignal (colour + icon + label) when a state is provided", () => {
    const { container } = render(<SafetySummary state="celiac-safe" />);
    expect(screen.getByText("Celiac-safe")).toBeInTheDocument();
    // Icon present and decorative — meaning lives in the visible label.
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // The "Not yet attested" empty state is gone once we have a verdict.
    expect(screen.queryByText("Not yet attested")).not.toBeInTheDocument();
  });

  it("renders distinct verdicts for celiac-safe vs gluten-friendly", () => {
    const { rerender } = render(<SafetySummary state="celiac-safe" />);
    expect(screen.getByText("Celiac-safe")).toBeInTheDocument();
    rerender(<SafetySummary state="gluten-friendly" />);
    expect(screen.getByText("Gluten-friendly")).toBeInTheDocument();
  });

  it("exposes an accessible heading for the section", () => {
    render(<SafetySummary state={null} />);
    expect(screen.getByRole("heading", { name: /gluten-free safety/i })).toBeInTheDocument();
  });

  it("keeps the accessible region + heading and the verdict in the hero variant", () => {
    render(<SafetySummary state="celiac-safe" variant="hero" />);
    // The accessible "Gluten-free safety" region name is stable across the
    // redesign — the heading is visually hidden in the hero, not removed.
    expect(screen.getByRole("region", { name: /gluten-free safety/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /gluten-free safety/i })).toBeInTheDocument();
    // The headline cue still renders with its colour + icon + label.
    expect(screen.getByText("Celiac-safe")).toBeInTheDocument();
  });

  it("keeps the honest empty state untouched in the hero variant", () => {
    render(<SafetySummary state={null} variant="hero" />);
    expect(screen.getByText("Not yet attested")).toBeInTheDocument();
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
  });

  // --- Combined hero badge row (repo-owner feedback, nits-detail-badges-once)
  //
  // The hero variant now owns the WHOLE safety-badge row for the listing detail
  // page — previously a standalone `SafetyBadges` row duplicated the headline
  // state below the hero. These cases migrate that component's behavioural
  // coverage (mutual exclusivity, the incident badge, the accessible group, and
  // keyboard-reachable tooltips) onto `SafetySummary`'s hero presentation.

  it("does not render the incident badge outside the hero variant", () => {
    render(<SafetySummary state="celiac-safe" hasRecentIncident={true} />);
    expect(screen.queryByText(safetyLabel("incident"))).not.toBeInTheDocument();
  });

  it("renders ONLY the celiac-safe badge in hero when there's no incident", () => {
    render(<SafetySummary state="celiac-safe" variant="hero" hasRecentIncident={false} />);
    expect(screen.getByText(safetyLabel("celiac-safe"))).toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("gluten-friendly"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("stale"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("incident"))).not.toBeInTheDocument();
  });

  it("renders ONLY the incident badge in hero when there's no headline state yet (unattested)", () => {
    render(<SafetySummary state={null} variant="hero" hasRecentIncident={true} />);
    expect(screen.getByText(safetyLabel("incident"))).toBeInTheDocument();
    expect(screen.getByText("Not yet attested")).toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("celiac-safe"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("gluten-friendly"))).not.toBeInTheDocument();
  });

  it("combines the headline badge WITH the incident badge in hero when both apply", () => {
    render(<SafetySummary state="celiac-safe" variant="hero" hasRecentIncident={true} />);
    expect(screen.getByText(safetyLabel("celiac-safe"))).toBeInTheDocument();
    expect(screen.getByText(safetyLabel("incident"))).toBeInTheDocument();
  });

  it("exposes the hero badge row to assistive tech as a labelled group, distinct from the section name", () => {
    render(<SafetySummary state="celiac-safe" variant="hero" hasRecentIncident={true} />);
    // An aria-label on a role-less (generic) div would be ignored by most AT, so
    // the row is a <fieldset> (implicit role=group) named by an sr-only
    // <legend> — the same pattern as ViewToggle / the retired SafetyBadges.
    expect(screen.getByRole("group", { name: "Safety status" })).toBeInTheDocument();
  });

  it("makes each hero badge keyboard-focusable so its supplementary tooltip is reachable", () => {
    render(<SafetySummary state="celiac-safe" variant="hero" hasRecentIncident={true} />);
    // A native button trigger is keyboard-focusable without an a11y-smell tabindex.
    const headlineTrigger = screen.getByText(safetyLabel("celiac-safe")).closest("button");
    expect(headlineTrigger).not.toBeNull();
    const incidentTrigger = screen.getByText(safetyLabel("incident")).closest("button");
    expect(incidentTrigger).not.toBeNull();
  });
});
