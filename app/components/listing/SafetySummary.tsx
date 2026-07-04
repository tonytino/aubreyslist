import { SafetySignal, type SafetyState } from "~/components/SafetySignal";

interface SafetySummaryProps {
  /**
   * The derived headline trust state, once EPIC 4 (#28/#29) computes it from
   * attestation data. While trust data does not exist, leave this `undefined`
   * (or `null`) and the component renders an honest "Not yet attested" empty
   * state instead of a fabricated rating.
   */
  state?: SafetyState | null;
  /**
   * Visual emphasis. `"default"` is the standalone section; `"hero"` (AUB-131)
   * scales the cue up to sit in the listing hero's solid bar below the media,
   * where it reads as the page's headline verdict. Both variants keep the
   * accessible region + heading and the honest empty state — only sizing and the
   * heading's visibility differ.
   */
  variant?: "default" | "hero";
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
 * IMPORTANT: we deliberately do NOT invent a safety rating — an old or fabricated
 * consensus could put a celiac at real risk. The `state` prop is the single seam
 * EPIC 4 wires up; everything else here already handles the populated render.
 *
 * The `"hero"` variant (AUB-131) renders the SAME cue at hero scale inside the
 * listing hero's solid bar. The `aria-labelledby` section + its heading are kept
 * in both variants (the heading is visually hidden in `"hero"` since the hero
 * band already reads as the headline), so the accessible "Gluten-free safety"
 * region name is stable across the redesign.
 */
export function SafetySummary({ state, variant = "default" }: SafetySummaryProps) {
  const isHero = variant === "hero";

  return (
    <section
      aria-labelledby="safety-summary-heading"
      className={isHero ? "flex flex-col" : "flex flex-col gap-3"}
    >
      <h2
        id="safety-summary-heading"
        className={
          isHero
            ? "sr-only"
            : "text-caption font-semibold uppercase tracking-wide text-muted-foreground"
        }
      >
        Gluten-free safety
      </h2>

      {state ? (
        <SafetySignal
          state={state}
          variant="solid"
          className={
            isHero ? "text-lead self-start px-4 py-2 gap-2" : "text-body self-start px-3 py-1.5"
          }
        />
      ) : (
        <div className="flex flex-col gap-1 rounded-card border border-dashed border-border bg-muted p-gutter">
          <p className="text-body font-semibold text-foreground">Not yet attested</p>
          <p className="text-body-sm text-muted-foreground">
            No one has confirmed yet whether this restaurant is celiac-safe or only gluten-friendly.
            Verify cross-contamination practices with the restaurant directly.
          </p>
        </div>
      )}
    </section>
  );
}
