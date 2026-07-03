import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { submitFlag } from "~/server/flags/flags.fn";

/**
 * Which content surface this control flags. The shape mirrors the exclusive-arc
 * target of the `flags` table (exactly one of listing/claim/incident).
 */
export type FlagTarget =
  | { target: "listing"; listingId: string }
  | { target: "claim"; claimId: string }
  | { target: "incident"; incidentId: string };

/**
 * A login-gated "Flag" affordance for a listing, claim, or incident (#39).
 *
 * Anonymous viewers see nothing — flagging is a write, and writes are
 * login-gated (the server function re-gates regardless, so hiding the control is
 * UX only). For signed-in viewers it renders a small "Flag" button (icon +
 * label, never colour alone) that toggles open a reason input; submitting calls
 * the `submitFlag` server function via TanStack Query and shows an inline
 * confirmation. The flag enters the moderation queue with `status: "open"`.
 *
 * Reusable / drop-in: takes only the target descriptor + the signed-in flag, so
 * the listing-detail, claim, and incident surfaces all reuse it unchanged.
 */
export function FlagControl(
  props: FlagTarget & {
    isSignedIn: boolean;
    label?: string;
    /**
     * `"inline"` (default) renders the small text "Flag" trigger that expands
     * into the reason form in place — used on claim/incident rows and anywhere
     * a text affordance fits. `"icon"` (AUB-131) renders a compact icon button +
     * tooltip whose reason form opens in a portaled dialog instead, so it can
     * live in tight spots (the listing hero's overlay) without the form
     * overflowing. Both share the same login gate + `submitFlag` write.
     */
    variant?: "inline" | "icon";
    /** Classes for the `"icon"` variant's trigger button (e.g. the hero's circular chip). */
    triggerClassName?: string;
  }
) {
  const { isSignedIn, label, variant = "inline", triggerClassName } = props;
  // Narrow the exclusive-arc descriptor without leaking the extra props.
  const targetData: FlagTarget =
    props.target === "listing"
      ? { target: "listing", listingId: props.listingId }
      : props.target === "claim"
        ? { target: "claim", claimId: props.claimId }
        : { target: "incident", incidentId: props.incidentId };

  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const formId = useId();

  const flag = useMutation({
    mutationFn: () => submitFlag({ data: { ...targetData, reason: reason.trim() } }),
    onSuccess: () => {
      setReason("");
      setIsOpen(false);
      toast.success("Report submitted");
    },
    onError: () => {
      toast.error("Could not submit the report. Please try again.");
    },
  });

  // Anonymous viewers cannot flag — writes are login-gated. Render nothing so the
  // surface stays clean (the server function rejects anonymous calls anyway).
  if (!isSignedIn) {
    return null;
  }

  const accessibleLabel = label ?? "Flag this content";
  const canSubmit = reason.trim() !== "" && !flag.isPending;

  const closeAndReset = () => {
    setIsOpen(false);
    setReason("");
  };

  // The reason-capture form, shared by BOTH presentations. In `"inline"` it
  // renders in place; in `"icon"` it is portaled inside a dialog. Submit/cancel
  // manage `isOpen`, so it closes the dialog too.
  const reasonForm = (
    <form
      aria-label={accessibleLabel}
      className="flex flex-col gap-2 rounded-card border border-border bg-muted p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          flag.mutate();
        }
      }}
    >
      <label
        htmlFor={`flag-reason-${formId}`}
        className="flex items-center gap-1.5 text-body-sm font-medium text-foreground"
      >
        <FlagIcon />
        Why are you flagging this?
      </label>
      <textarea
        id={`flag-reason-${formId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        maxLength={2000}
        required
        placeholder="Inappropriate, spam, or wrong information…"
        className="rounded-card border border-border bg-background px-3 py-2 text-body-sm text-foreground"
      />

      {flag.isError ? (
        <p role="alert" className="text-body-sm text-incident">
          {flag.error instanceof Error
            ? flag.error.message
            : "Could not submit the flag. Please try again."}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {flag.isPending ? "Submitting…" : "Submit flag"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={flag.isPending}
          onClick={closeAndReset}
        >
          Cancel
        </Button>
      </div>
    </form>
  );

  // Icon presentation (AUB-131): a compact icon button + tooltip; the reason form
  // opens in a portaled dialog so it never overflows a tight host (the hero).
  if (variant === "icon") {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={accessibleLabel}
              onClick={() => setIsOpen(true)}
              className={triggerClassName}
            >
              <FlagIcon />
            </button>
          </TooltipTrigger>
          <TooltipContent>{label ?? "Flag"}</TooltipContent>
        </Tooltip>
        <Dialog open={isOpen} onOpenChange={(open) => (open ? setIsOpen(true) : closeAndReset())}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{accessibleLabel}</DialogTitle>
              <DialogDescription>
                Tell a moderator why — inappropriate, spam, or wrong information. It enters the
                moderation queue for review.
              </DialogDescription>
            </DialogHeader>
            {reasonForm}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (flag.isSuccess && !isOpen) {
    return (
      <output className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
        <FlagIcon />
        Reported. Thanks — a moderator will review it.
      </output>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        <FlagIcon />
        <span>{label ?? "Flag"}</span>
      </button>
    );
  }

  return reasonForm;
}

/** Decorative flag glyph — the adjacent text label carries the meaning. */
function FlagIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 21V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  );
}
