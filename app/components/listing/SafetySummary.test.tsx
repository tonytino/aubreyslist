import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { safetyLabel } from "~/components/SafetySignal";
import { SafetySummary } from "./SafetySummary";

// One constant, no branch on WHY there is no verdict: the wording must be true
// of a disputed claim as well as an unattested one, so it states only that the
// listing is not confirmed celiac-safe.
const GUIDANCE_TEXT =
  "This restaurant isn't confirmed celiac-safe. " +
  "Verify cross-contamination practices with the restaurant directly.";

describe("SafetySummary", () => {
  it("renders honest guidance prose when no trust data exists (no fabricated rating, no badge)", () => {
    render(<SafetySummary state={null} />);
    expect(screen.getByTestId("safety-summary-guidance")).toHaveTextContent(GUIDANCE_TEXT);
    // The empty state must not claim a celiac-safe verdict, and must not render
    // any safety badge at all — an unattested and a disputed claim look alike.
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
    expect(document.querySelector("[data-safety-state]")).not.toBeInTheDocument();
  });

  it("treats undefined state the same as null (guidance prose)", () => {
    render(<SafetySummary />);
    expect(screen.getByTestId("safety-summary-guidance")).toHaveTextContent(GUIDANCE_TEXT);
  });

  it("renders the accessible SafetySignal (colour + icon + label) when a state is provided", () => {
    const { container } = render(<SafetySummary state="celiac-safe" />);
    expect(screen.getByText("Celiac-safe")).toBeInTheDocument();
    // Icon present and decorative — meaning lives in the visible label.
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // The guidance prose is gone once we have a verdict.
    expect(screen.queryByTestId("safety-summary-guidance")).not.toBeInTheDocument();
  });

  it("exposes an accessible heading for the section", () => {
    render(<SafetySummary state={null} />);
    expect(screen.getByRole("heading", { name: /gluten-free safety/i })).toBeInTheDocument();
  });

  it("keeps the accessible region + heading and the verdict in the hero variant", () => {
    render(<SafetySummary state="celiac-safe" variant="hero" />);
    // The accessible "Gluten-free safety" region name is stable across variants —
    // the heading is visually hidden in the hero, not removed.
    expect(screen.getByRole("region", { name: /gluten-free safety/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /gluten-free safety/i })).toBeInTheDocument();
    // The headline cue still renders with its colour + icon + label.
    expect(screen.getByText("Celiac-safe")).toBeInTheDocument();
  });

  it("keeps the guidance prose untouched in the hero variant", () => {
    render(<SafetySummary state={null} variant="hero" />);
    expect(screen.getByTestId("safety-summary-guidance")).toHaveTextContent(GUIDANCE_TEXT);
    expect(screen.queryByText("Celiac-safe")).not.toBeInTheDocument();
  });

  // --- Combined hero badge row
  //
  // The hero variant owns the whole safety-badge row for the listing detail page.
  // These cases cover mutual exclusivity, the incident badge, the accessible
  // group, and keyboard-reachable tooltips.

  it("does not render the incident badge outside the hero variant", () => {
    render(<SafetySummary state="celiac-safe" hasRecentIncident={true} />);
    expect(screen.queryByText(safetyLabel("incident"))).not.toBeInTheDocument();
  });

  it("renders ONLY the celiac-safe badge in hero when there's no incident", () => {
    render(<SafetySummary state="celiac-safe" variant="hero" hasRecentIncident={false} />);
    expect(screen.getByText(safetyLabel("celiac-safe"))).toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("stale"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("incident"))).not.toBeInTheDocument();
  });

  it("renders ONLY the stale badge in hero when that's the headline state", () => {
    render(<SafetySummary state="stale" variant="hero" hasRecentIncident={false} />);
    expect(screen.getByText(safetyLabel("stale"))).toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("celiac-safe"))).not.toBeInTheDocument();
    expect(screen.queryByText(safetyLabel("incident"))).not.toBeInTheDocument();
  });

  it("combines the stale badge WITH the incident badge in hero when both apply", () => {
    render(<SafetySummary state="stale" variant="hero" hasRecentIncident={true} />);
    expect(screen.getByText(safetyLabel("stale"))).toBeInTheDocument();
    expect(screen.getByText(safetyLabel("incident"))).toBeInTheDocument();
  });

  it("renders ONLY the incident badge in hero when there's no headline state yet (unattested/disputed)", () => {
    render(<SafetySummary state={null} variant="hero" hasRecentIncident={true} />);
    expect(screen.getByText(safetyLabel("incident"))).toBeInTheDocument();
    expect(screen.getByTestId("safety-summary-guidance")).toHaveTextContent(GUIDANCE_TEXT);
    expect(screen.queryByText(safetyLabel("celiac-safe"))).not.toBeInTheDocument();
  });

  it("keeps the guidance prose visible in hero alongside the incident badge (no dashed empty-state chip)", () => {
    render(<SafetySummary state={null} variant="hero" hasRecentIncident={true} />);
    // No "Not yet attested" badge of any kind — only the incident badge sits in
    // the fieldset row, and guidance renders as plain prose below it.
    expect(screen.queryByText("Not yet attested")).not.toBeInTheDocument();
    expect(screen.getByTestId("safety-summary-guidance")).toHaveTextContent(GUIDANCE_TEXT);
  });

  it("keeps the FULL guidance prose visible in hero when there is no incident badge either", () => {
    render(<SafetySummary state={null} variant="hero" hasRecentIncident={false} />);
    expect(screen.getByTestId("safety-summary-guidance")).toHaveTextContent(GUIDANCE_TEXT);
  });

  it("skips the 'Safety status' fieldset entirely when there is no badge to group (null state, no incident)", () => {
    render(<SafetySummary state={null} variant="hero" hasRecentIncident={false} />);
    // An empty labelled group would announce a "Safety status" region that holds
    // nothing — so the fieldset itself must not render.
    expect(screen.queryByRole("group", { name: "Safety status" })).not.toBeInTheDocument();
  });

  it("keeps the default-variant headline chip bare — no tooltip trigger button", () => {
    render(<SafetySummary state="celiac-safe" />);
    // Only the hero row wraps badges in tooltip triggers; the default variant
    // stays the plain self-positioned chip.
    expect(screen.getByText(safetyLabel("celiac-safe")).closest("button")).toBeNull();
  });

  it("combines the headline badge WITH the incident badge in hero when both apply", () => {
    render(<SafetySummary state="celiac-safe" variant="hero" hasRecentIncident={true} />);
    expect(screen.getByText(safetyLabel("celiac-safe"))).toBeInTheDocument();
    expect(screen.getByText(safetyLabel("incident"))).toBeInTheDocument();
  });

  it("exposes the hero badge row to assistive tech as a labelled group, distinct from the section name", () => {
    render(<SafetySummary state="celiac-safe" variant="hero" hasRecentIncident={true} />);
    // An aria-label on a role-less (generic) div would be ignored by most AT, so
    // the row is a <fieldset> (implicit role=group) named by an sr-only <legend>.
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
