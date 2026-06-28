import { SafetySignal, type SafetyState } from "~/components/SafetySignal";

interface SafetySummaryProps {
  /**
   * The derived headline trust state, once EPIC 4 (#28/#29) computes it from
   * attestation data. While trust data does not exist, leave this `undefined`
   * (or `null`) and the component renders an honest "Not yet attested" empty
   * state instead of a fabricated rating.
   */
  state?: SafetyState | null;
}

/**
 * The prominent, headline celiac-safe vs. gluten-friendly signal for a listing.
 *
 * This is the most important cue on the page (docs/agents/domain.md → "surface
 * this most prominently"). It is accessible by construction: the populated case
 * delegates to {@link SafetySignal}, which always pairs COLOUR + ICON + TEXT
 * LABEL, and the empty case states "Not yet attested" in plain text so the
 * meaning never depends on colour or styling.
 *
 * IMPORTANT: trust data is not built yet. We deliberately do NOT invent a
 * safety rating — an old or fabricated consensus could put a celiac at real
 * risk. The `state` prop is the single seam EPIC 4 wires up; everything else
 * here already handles the populated render.
 */
export function SafetySummary({ state }: SafetySummaryProps) {
  return (
    <section aria-labelledby="safety-summary-heading" className="flex flex-col gap-3">
      <h2
        id="safety-summary-heading"
        className="text-caption font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Gluten-free safety
      </h2>

      {state ? (
        <SafetySignal state={state} variant="solid" className="text-body self-start px-3 py-1.5" />
      ) : (
        <div className="flex flex-col gap-1 rounded-card border border-dashed border-border bg-surface p-gutter">
          <p className="text-body font-semibold text-foreground">Not yet attested</p>
          <p className="text-body-sm text-muted-foreground">
            No one has confirmed yet whether this restaurant is celiac-safe or only gluten-friendly.
            Community trust data is coming soon — until then, please verify cross-contamination
            practices directly with the restaurant.
          </p>
        </div>
      )}
    </section>
  );
}
