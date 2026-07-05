import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { WheatStrike } from "~/components/icons/WheatStrike";
import type { AttestationValue, ClaimAttribute } from "~/db/schema";
import { removeVote, submitVote } from "~/server/attestations/attestations.fn";
import { CLAIM_ATTRIBUTE_ICONS, CLAIM_ATTRIBUTE_LABELS } from "~/trust/summary";
import { claimsQueryKey } from "./CommunityClaims";

interface ClaimVoteControlsProps {
  listingId: string;
  /**
   * The taxonomy attribute this row attests (#150). Votes are addressed by
   * `(listingId, attribute)` — the claim row is created lazily server-side on
   * the first vote — so the controls work even when no claim exists yet.
   */
  attribute: ClaimAttribute;
  /** The viewer's current vote on this attribute, or `null` if they haven't voted. */
  viewerVote: AttestationValue | null;
  /** Whether the viewer is signed in — gates the controls (UX only). */
  isSignedIn: boolean;
}

/**
 * Per-attribute confirm/dispute controls (#28 server logic, wired for #32,
 * extended in #150 to attest by `(listingId, attribute)` with lazy claim
 * creation so EVERY taxonomy attribute is attestable).
 *
 * The two buttons are TOGGLES (owner feedback): pressing the button for your
 * current vote retracts it (`removeVote`); pressing the other one switches your
 * vote via the same upsert (`submitVote`). There is no separate "Retract" link.
 *
 * Each button presents as the claim's BADGE rather than a generic
 * Confirm/Dispute pair, so a pressed vote reads as the same badge language the
 * rest of the app uses (`SafetySignal` chip shape + safety colour tokens):
 *
 * - Headline claim (`celiac_safe_vs_gluten_friendly`): confirm renders as the
 *   Celiac-safe badge (shield + check) and dispute as the Gluten-friendly badge
 *   (struck-out wheat) — matching the claim's meaning (confirm = celiac-safe,
 *   dispute = only gluten-friendly).
 * - Every other attribute: confirm renders as that attribute's badge (its
 *   `CLAIM_ATTRIBUTE_ICONS` glyph + `CLAIM_ATTRIBUTE_LABELS` label); dispute is
 *   a consistent X + "Dispute" badge across all non-headline claims.
 *
 * Meaning NEVER rests on colour alone (styling.md non-negotiable): every state
 * pairs an icon + visible text label, and `aria-pressed` announces the toggle.
 * All writes are re-gated + scoped to the current user's own row server-side;
 * the controls are UX only.
 *
 * After any change the listing's claim roll-up query is invalidated so the
 * counts, recency, the viewer's own vote highlight, and the headline cue all
 * recompute from fresh, visible evidence.
 */
export function ClaimVoteControls({
  listingId,
  attribute,
  viewerVote,
  isSignedIn,
}: ClaimVoteControlsProps) {
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: claimsQueryKey(listingId) });

  // Both onSuccess handlers RETURN the invalidation promise so `isPending`
  // (and thus `busy`) holds until the roll-up refetch settles. The toggle
  // branches on `viewerVote`, which comes from that query — re-enabling before
  // it lands would let a quick second click act on a stale vote (e.g. re-submit
  // a confirm it should retract).
  const vote = useMutation({
    mutationFn: (value: AttestationValue) => submitVote({ data: { listingId, attribute, value } }),
    onSuccess: () => {
      // A single neutral message regardless of confirm vs dispute — the button's
      // own pressed state already conveys which one was cast.
      toast.success("Vote recorded");
      return invalidate();
    },
    onError: () => {
      toast.error("Could not record your vote. Please try again.");
    },
  });

  const retract = useMutation({
    mutationFn: () => removeVote({ data: { listingId, attribute } }),
    onSuccess: () => {
      toast.success("Vote retracted");
      return invalidate();
    },
    onError: () => {
      toast.error("Could not retract your vote. Please try again.");
    },
  });

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
      retract.mutate();
    } else {
      vote.mutate(value);
    }
  };

  // The headline claim's two sides ARE the two safety states, so its buttons
  // present as the Celiac-safe / Gluten-friendly badges. Every other attribute
  // confirms as its own badge and disputes via a consistent X + "Dispute".
  const isHeadline = attribute === "celiac_safe_vs_gluten_friendly";

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
        {/* Visible ownership cue: a pressed vote badge is deliberately the same
            badge language as a SafetySignal verdict chip, so this caption keeps
            "your vote" from reading as the community verdict (ADR-007). Screen
            readers already get the ownership from the toggle's `aria-pressed`. */}
        {viewerVote !== null ? (
          <span className="text-caption text-muted-foreground">
            {viewerVote === "confirm" ? "You confirmed this." : "You disputed this."}
          </span>
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
  /** Colour fill utilities applied ONLY while pressed (safety tokens). */
  pressedClassName: string;
  disabled: boolean;
  onClick: () => void;
}

/**
 * A badge-shaped toggle button sharing `SafetySignal`'s chip shape language
 * (rounded chip, `size-4` glyph, `text-body-sm` label) so a pressed vote reads
 * identically to the same state everywhere else. Unpressed it is a neutral
 * outline badge; pressed it fills with the caller's safety colour. Icon + text
 * label are always present and `aria-pressed` announces the state, so the
 * meaning never rests on colour alone.
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
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-chip border px-2.5 py-1 text-body-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 ${
        pressed ? pressedClassName : "border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
      <span>{label}</span>
    </button>
  );
}
