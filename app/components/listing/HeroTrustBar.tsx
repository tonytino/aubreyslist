import { ActivityLine, HappyPatrons } from "~/components/listing/ListingActivity";
import { SafetySummary } from "~/components/listing/SafetySummary";
import type { SafetyState } from "~/components/SafetySignal";
import type { ListingActivityMeta } from "~/trust/summary";

/**
 * The listing hero's solid bar under the media: the safety verdict, then the
 * listing-activity strip.
 *
 * **One fixed slot for the strip.** The bar is a column, so the strip is always
 * the second child of this container with the same gap above it, whatever
 * `SafetySummary` rendered — a celiac-safe or stale badge, the incident chip,
 * the guidance prose, or a badge and prose together. Laying the two out as
 * siblings in a wrapping row instead makes the strip's position depend on its
 * neighbour: a badge is a ~100px chip, the guidance is a `max-w-prose`
 * paragraph, and a centred wrap row puts the strip in a visibly different place
 * for each. Keep this a column; do not fold the strip back in beside the
 * verdict.
 *
 * The split between the two rows is also the ADR-007 boundary. `SafetySummary`
 * owns every safety cue; the strip below it owns activity, which is not a
 * safety cue and says so in its own tooltip. Neither belongs inside the other.
 *
 * Mirrors the browse card's anatomy: verdict row, then meta row, the meta row
 * always present.
 */
export function HeroTrustBar({
  safetyState,
  hasRecentIncident,
  activity,
}: {
  /** The headline verdict, or `null` for the honest no-verdict guidance. */
  safetyState: SafetyState | null;
  /** Whether a recent "got glutened" report adds the incident badge. */
  hasRecentIncident: boolean;
  /** The derived "Updated …" line plus happy-patron count. */
  activity: ListingActivityMeta;
}) {
  return (
    <div data-testid="hero-trust-bar" className="flex flex-col gap-3 p-card">
      <SafetySummary state={safetyState} variant="hero" hasRecentIncident={hasRecentIncident} />

      {/* Always present, in this slot: the "Updated …" line (or the honest "No
          activity yet") plus the happy-patron count when there is one. No
          conditional margin — the container's gap is the only spacing, so the
          row cannot drift with the state above it. */}
      <div
        data-testid="hero-activity"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-muted-foreground"
      >
        <ActivityLine meta={activity} />
        <HappyPatrons meta={activity} />
      </div>
    </div>
  );
}
