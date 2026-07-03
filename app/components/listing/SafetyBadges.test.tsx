import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { safetyLabel } from "~/components/SafetySignal";
import { SafetyBadges } from "./SafetyBadges";

describe("SafetyBadges", () => {
  it("renders ONLY the celiac-safe badge when that's the headline state and there's no incident", () => {
    render(<SafetyBadges state="celiac-safe" hasRecentIncident={false} />);
    expect(screen.getByText(safetyLabel("celiac-safe"))).toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("gluten-friendly"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("stale"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("incident"))).not.toBeInTheDocument();
  });

  it("renders ONLY the gluten-friendly badge when that's the headline state", () => {
    render(<SafetyBadges state="gluten-friendly" hasRecentIncident={false} />);
    expect(screen.getByText(safetyLabel("gluten-friendly"))).toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("celiac-safe"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("incident"))).not.toBeInTheDocument();
  });

  it("renders ONLY the stale badge when that's the headline state", () => {
    render(<SafetyBadges state="stale" hasRecentIncident={false} />);
    expect(screen.getByText(safetyLabel("stale"))).toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("celiac-safe"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("incident"))).not.toBeInTheDocument();
  });

  it("renders ONLY the incident badge when there's no headline state yet (unattested)", () => {
    render(<SafetyBadges state={null} hasRecentIncident={true} />);
    expect(screen.getByText(safetyLabel("incident"))).toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("celiac-safe"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("gluten-friendly"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("stale"))).not.toBeInTheDocument();
  });

  it("combines the headline badge WITH the incident badge when both apply", () => {
    render(<SafetyBadges state="celiac-safe" hasRecentIncident={true} />);
    expect(screen.getByText(safetyLabel("celiac-safe"))).toBeInTheDocument();
    expect(screen.getByText(safetyLabel("incident"))).toBeInTheDocument();
  });

  it("renders nothing (no empty gap) when neither a headline state nor an incident applies", () => {
    const { container } = render(<SafetyBadges state={null} hasRecentIncident={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has NO heading/section label — it is a quiet row, not a titled panel", () => {
    render(<SafetyBadges state="celiac-safe" hasRecentIncident={true} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("exposes the row to assistive tech as a labelled group", () => {
    render(<SafetyBadges state="celiac-safe" hasRecentIncident={true} />);
    // An aria-label on a role-less (generic) div would be ignored by most AT, so
    // the wrapper is a <fieldset> (implicit role=group) named by an sr-only
    // <legend> — the same pattern as ViewToggle.
    expect(screen.getByRole("group", { name: "Safety status" })).toBeInTheDocument();
  });

  it("makes each badge keyboard-focusable so its supplementary tooltip is reachable", () => {
    render(<SafetyBadges state="celiac-safe" hasRecentIncident={true} />);
    // A native button trigger is keyboard-focusable without an a11y-smell tabindex.
    const headlineTrigger = screen.getByText(safetyLabel("celiac-safe")).closest("button");
    expect(headlineTrigger).not.toBeNull();
    const incidentTrigger = screen.getByText(safetyLabel("incident")).closest("button");
    expect(incidentTrigger).not.toBeNull();
  });
});
