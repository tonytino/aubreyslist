import { Clock, Users } from "lucide-react";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { ACTIVITY_TOOLTIP, type ListingActivityMeta } from "~/trust/summary";

/**
 * The listing-activity meta strip — the "Updated 3 days ago" line and the
 * "12 happy patrons" count — shared by the browse card and the listing-detail
 * hero, so neither surface can drift on wording. The map mini-card is one
 * button end to end, so it mirrors the line as plain text and carries
 * `ACTIVITY_NAME_CLARIFIER` in its accessible name instead of a trigger.
 *
 * **Activity, not safety** (owner decision 2026-08-25). The line reports that
 * people have been voting on this listing's claims lately; it is not a
 * verification, and it shows for a contested listing exactly as it does for an
 * affirmed one. That is only honest because `ACTIVITY_TOOLTIP` is always one
 * tap away, so the tooltip is part of the contract, never decoration. The
 * safety verdict stays exclusively with `SafetySignal`/`SafetySummary`.
 */

/**
 * The activity line as a click/tap-toggled tooltip trigger.
 *
 * Touch is the reason this is click-driven rather than the repo's usual
 * hover/focus tooltip (the save-count pill, the safety badges): a hover
 * tooltip is unreachable on a phone, and this clarifier is the one thing
 * keeping "Updated 3 days ago" from reading as a safety claim. `onPointerDown`
 * with `preventDefault()` is what makes the toggle work on both: Radix composes
 * a consumer handler ahead of its own and skips its internal close when the
 * consumer prevents default, so one gesture toggles instead of Radix closing
 * and this reopening. Hover and keyboard focus still open it through Radix's
 * own path, so a mouse or keyboard user needs no click at all.
 *
 * The trigger is a real `<button type="button">` — natively focusable, honest
 * semantics for the tooltip — and its visible text carries the whole meaning,
 * so nothing depends on the tooltip being opened (styling.md).
 */
export function ActivityLine({
  meta,
  className,
}: {
  meta: ListingActivityMeta;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="activity-line"
          // Prevent-default first: Radix's own pointer-down handler closes the
          // tooltip, which would fight this toggle on a second tap.
          onPointerDown={(event) => {
            event.preventDefault();
            setOpen((previous) => !previous);
          }}
          className={cn(
            // `-my-1.5 py-1.5` grows the pointer target to ~28px tall without
            // moving the row: the caption line alone leaves a target under the
            // 24px minimum, and this clarifier is the one thing keeping the line
            // from reading as a verdict, so it has to be easy to hit on a phone.
            "-my-1.5 inline-flex min-w-0 items-center gap-1.5 rounded-chip py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-ring",
            // Both states use the full-strength muted token (6.7:1 on the card
            // in light, 7.0:1 in dark). The empty state differs by weight, never
            // by an opacity modifier: `text-muted-foreground/80` computes 4.1:1
            // on the light card, under the 4.5:1 AA floor (styling.md).
            "text-muted-foreground",
            meta.hasActivity ? "font-medium" : "font-normal",
            className
          )}
        >
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          {/* The dotted underline is the affordance: it is the one visual cue
              that this line has an explanation behind it, matching the "AI"
              marker's treatment on a suggested ClaimBadge. It is never the
              MEANING — the visible words carry that — only the invitation to
              tap. Surfaces that cannot host a trigger (the map mini-card) do
              not draw it, so a dotted line always means "there is something
              here to open". */}
          <span className="truncate underline decoration-dotted underline-offset-2">
            {meta.updatedLabel}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px]">{ACTIVITY_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The happy-patron count: people who confirmed a claim here and never reported
 * an incident. Renders nothing at zero — an honest absence, never "0 happy
 * patrons". A community count, not a safety verdict (ADR-007), so it stays
 * muted and out of the safety-signal row.
 *
 * Two sizes, one component, so the browse card and the map mini-card cannot
 * drift on what the count means or how it is spelled:
 *
 * - `full` (browse card, detail hero) — glyph + the whole "12 happy patrons"
 *   phrase. The noun is visible, because there is room for it.
 * - `compact` (map mini-card, 224px) — a painted bare number beside a
 *   visually-hidden "12 happy patrons". Never a naked digit in the accessibility
 *   tree: "12" read out beside a safety label is exactly the ambiguity ADR-007
 *   forbids. Real text rather than `aria-label`, because a generic `<span>` has
 *   no role to hang a name on. A surface that overrides the whole subtree's name
 *   (the mini-card is one `<button aria-label>`) must still fold the phrase into
 *   that name itself.
 */
export function HappyPatrons({
  meta,
  size = "full",
  className,
}: {
  meta: ListingActivityMeta;
  size?: "full" | "compact";
  className?: string;
}) {
  if (meta.happyPatronsLabel === null) {
    return null;
  }
  const compact = size === "compact";
  return (
    <span
      data-testid="happy-patrons"
      className={cn(
        "inline-flex shrink-0 items-center font-medium text-muted-foreground",
        compact ? "gap-1 tabular-nums" : "gap-1.5",
        className
      )}
    >
      <Users className={compact ? "size-3.5 shrink-0" : "h-4 w-4 shrink-0"} aria-hidden="true" />
      {compact ? (
        <>
          <span aria-hidden="true">{meta.happyPatrons}</span>
          <span className="sr-only">{meta.happyPatronsLabel}</span>
        </>
      ) : (
        <span>{meta.happyPatronsLabel}</span>
      )}
    </span>
  );
}
