import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { WheatStrike } from "~/components/icons/WheatStrike";
import type { AttestationValue, ClaimAttribute } from "~/db/schema";
import { cn } from "~/lib/utils";
import { CLAIM_ATTRIBUTE_ICONS, CLAIM_ATTRIBUTE_LABELS } from "~/trust/summary";
import { ClaimChip } from "./ClaimChip";
import { useClaimVoteMutations } from "./use-claim-vote-mutations";

interface ClaimVoteControlsProps {
  listingId: string;
  /**
   * The taxonomy attribute this row attests. Votes are addressed by
   * `(listingId, attribute)` — the claim row is created lazily server-side on the
   * first vote — so the controls work even when no claim exists yet.
   */
  attribute: ClaimAttribute;
  /** The viewer's current vote on this attribute, or `null` if they haven't voted. */
  viewerVote: AttestationValue | null;
  /** Whether the viewer is signed in — gates the controls (UX only). */
  isSignedIn: boolean;
}

/**
 * Per-attribute confirm/dispute controls. Every taxonomy attribute is attestable —
 * claim rows are created lazily server-side on the first vote.
 *
 * The two buttons are toggles: pressing your current vote retracts it; pressing the
 * other one switches your vote via the same upsert. There is no separate "Retract"
 * link.
 *
 * Each button presents as the claim's badge, so a pressed vote reads as the same
 * badge language the rest of the app uses:
 *
 * - Headline claim (`celiac_safe_vs_gluten_friendly`): confirm renders as the
 *   Celiac-safe badge, dispute as the Gluten-friendly badge — matching the claim's
 *   meaning.
 * - Every other attribute: confirm renders as that attribute's badge; dispute is a
 *   consistent X + "Dispute" badge.
 *
 * Meaning never rests on colour alone (styling.md): every state pairs an icon +
 * visible text label, and `aria-pressed` announces the toggle. Writes are re-gated
 * and scoped to the current user's own row server-side; the controls are UX only.
 *
 * After any change the claim roll-up query is invalidated so counts, recency, the
 * viewer's vote highlight, and the headline cue recompute from fresh evidence.
 */
export function ClaimVoteControls({
  listingId,
  attribute,
  viewerVote,
  isSignedIn,
}: ClaimVoteControlsProps) {
  // Shared mutation seam: write + roll-up invalidation live in the hook — its
  // onSuccess returns the invalidation promise so `isPending` (and thus `busy`)
  // holds until the refetch settles. The toggle branches on `viewerVote`, which
  // comes from that query — re-enabling before it lands would let a quick second
  // click act on a stale vote. Toasts are this surface's concern, supplied
  // per-mutate.
  const { vote, retract } = useClaimVoteMutations(listingId);

  if (!isSignedIn) {
    return (
      <p className="text-body-sm text-muted-foreground">
        <a href="/api/auth/google" className="underline underline-offset-4">
          Sign in
        </a>{" "}
        to confirm or dispute this.
      </p>
    );
  }

  const busy = vote.isPending || retract.isPending;
  const error = vote.error ?? retract.error;

  // Toggle semantics: pressing your current vote retracts it; pressing the
  // other side switches it (the server upsert handles the change in one call).
  const toggle = (value: AttestationValue) => {
    if (viewerVote === value) {
      retract.mutate(
        { attribute },
        {
          onSuccess: () => {
            toast.success("Vote retracted");
          },
          onError: () => {
            toast.error("Could not retract your vote. Please try again.");
          },
        }
      );
    } else {
      vote.mutate(
        { attribute, value },
        {
          onSuccess: () => {
            // A single neutral message regardless of confirm vs dispute — the
            // button's own pressed state already conveys which one was cast.
            toast.success("Vote recorded");
          },
          onError: () => {
            toast.error("Could not record your vote. Please try again.");
          },
        }
      );
    }
  };

  // The headline claim's two sides are the two safety states, so its buttons
  // present as the Celiac-safe / Gluten-friendly badges.
  const isHeadline = attribute === "celiac_safe_vs_gluten_friendly";

  // Ownership caption for a pressed vote. For the headline claim,
  // "You confirmed/disputed this." reads awkwardly beside its safety-state badges,
  // so name the state the vote records instead. Rendered only when the viewer has
  // voted; meaning is also carried by each toggle's `aria-pressed`.
  const ownershipCaption = isHeadline
    ? viewerVote === "confirm"
      ? "You marked this celiac-safe."
      : "You marked this gluten-friendly."
    : viewerVote === "confirm"
      ? "You confirmed this."
      : "You disputed this.";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <VoteBadgeButton
          icon={CLAIM_ATTRIBUTE_ICONS[attribute]}
          label={CLAIM_ATTRIBUTE_LABELS[attribute]}
          pressed={viewerVote === "confirm"}
          pressedClassName="border-celiac-safe bg-celiac-safe text-celiac-safe-foreground hover:bg-celiac-safe/90"
          disabled={busy}
          onClick={() => toggle("confirm")}
        />
        <VoteBadgeButton
          icon={isHeadline ? WheatStrike : X}
          label={isHeadline ? "Gluten-friendly" : "Dispute"}
          pressed={viewerVote === "dispute"}
          pressedClassName={
            isHeadline
              ? "border-gluten-friendly bg-gluten-friendly text-gluten-friendly-foreground hover:bg-gluten-friendly/90"
              : "border-incident bg-incident text-incident-foreground hover:bg-incident/90"
          }
          disabled={busy}
          onClick={() => toggle("dispute")}
        />
        {/* Visible ownership cue: a pressed vote badge shares the SafetySignal chip
            language, so this caption keeps "your vote" from reading as the community
            verdict (ADR-007). Screen readers get ownership from `aria-pressed`. */}
        {viewerVote !== null ? (
          <span className="text-caption text-muted-foreground">{ownershipCaption}</span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-body-sm text-incident">
          {error instanceof Error ? error.message : "Could not record your vote. Please try again."}
        </p>
      ) : null}
    </div>
  );
}

interface VoteBadgeButtonProps {
  /** Decorative glyph — the visible text label carries the meaning. */
  icon: LucideIcon;
  label: string;
  pressed: boolean;
  /** Colour fill utilities applied only while pressed (safety tokens). */
  pressedClassName: string;
  disabled: boolean;
  onClick: () => void;
}

/**
 * A badge-shaped toggle button rendered through the shared {@link ClaimChip}
 * primitive — the same chip the static `ClaimBadge` / `FactOutcomeChip` use, so the
 * toggle and the display badges are one component, not two kept in visual sync.
 * `ClaimChip` supplies icon + label + family size/shape; via `asChild` (Radix `Slot`)
 * it renders onto the real native `<button>`, which adds only its interactive
 * concerns — `aria-pressed`, `disabled`, `onClick`, the pressed fill, the focus ring.
 *
 * Icon + visible text label are always present and `aria-pressed` announces the
 * toggle, so meaning never rests on colour alone. The `<button>` stays a first-class
 * element, so keyboard/focus/disabled semantics are native, not simulated.
 */
function VoteBadgeButton({
  icon: Icon,
  label,
  pressed,
  pressedClassName,
  disabled,
  onClick,
}: VoteBadgeButtonProps) {
  return (
    <ClaimChip asChild icon={Icon} iconProps={{ strokeWidth: 2.25 }} label={label}>
      <button
        type="button"
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
          pressed ? pressedClassName : "border-border bg-background text-foreground hover:bg-muted"
        )}
      />
    </ClaimChip>
  );
}
