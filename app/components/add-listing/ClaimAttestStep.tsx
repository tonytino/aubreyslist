import { ArrowLeft, Check, HelpCircle, ShieldCheck, X } from "lucide-react";
import { WheatStrike } from "~/components/icons/WheatStrike";
import { SafetySignal } from "~/components/SafetySignal";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { ClaimAttribute } from "~/listings/taxonomy";
import { claimAttributeDescription, claimAttributeLabel } from "~/trust/summary";
import type { Answer } from "./AddListingWizard";

/**
 * One attestation step — a single taxonomy attribute the user can confirm,
 * dispute, or SKIP. It is a CONTROLLED control: choosing an answer calls
 * `onAnswer` (the parent stores it + advances) and writes NOTHING to the server.
 * The deferred write happens once, on the wizard's final submit.
 *
 * Skip is first-class and equal-weight (a dashed "I'm not sure"): a celiac is
 * better served by an honest gap than by a guessed confirm/dispute.
 *
 * The HEADLINE attribute (`celiac_safe_vs_gluten_friendly`) is special — a bare
 * confirm/dispute is otherwise ambiguous — so ONLY it shows the "what your answer
 * records" safety preview (Confirm → celiac-safe, Dispute → gluten-friendly) and
 * carries the safety icons (green shield-check / amber struck-wheat) on its
 * buttons. The other four are plain facts: neutral check / ✗ icons, NO safety
 * colour.
 *
 * Every attribute's helper copy comes from {@link claimAttributeDescription} —
 * the same shared one-liners the listing-detail Community-claims surface
 * renders, so the wizard and the trust summary never drift.
 */

const HEADLINE = "celiac_safe_vs_gluten_friendly" as const;

export function ClaimAttestStep({
  attribute,
  value,
  onAnswer,
  onBack,
}: {
  attribute: ClaimAttribute;
  value: Answer | undefined;
  onAnswer: (value: Answer) => void;
  onBack: () => void;
}) {
  const isHeadline = attribute === HEADLINE;
  const label = claimAttributeLabel(attribute);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-title font-semibold">{label}</h2>
        <p className="text-body text-muted-foreground">{claimAttributeDescription(attribute)}</p>
      </div>

      {isHeadline ? (
        <div className="flex flex-col gap-2 rounded-card border border-border bg-muted/40 p-card">
          <span className="text-body-sm font-medium text-foreground">What your answer records</span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <span className="flex flex-wrap items-center gap-1.5 text-body-sm text-muted-foreground">
              Confirm records <SafetySignal state="celiac-safe" />
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-body-sm text-muted-foreground">
              Dispute records <SafetySignal state="gluten-friendly" />
            </span>
          </div>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-3" aria-label={`Your answer for ${label}`}>
        <Button
          type="button"
          variant={value === "confirm" ? "default" : "outline"}
          aria-pressed={value === "confirm"}
          onClick={() => onAnswer("confirm")}
          className="h-auto w-full justify-start gap-3 py-3 text-body"
        >
          {isHeadline ? (
            <ShieldCheck
              aria-hidden="true"
              className={cn("size-5 shrink-0", value !== "confirm" && "text-celiac-safe")}
              strokeWidth={2.25}
            />
          ) : (
            <Check aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.25} />
          )}
          Confirm
        </Button>

        <Button
          type="button"
          variant={value === "dispute" ? "secondary" : "outline"}
          aria-pressed={value === "dispute"}
          onClick={() => onAnswer("dispute")}
          className="h-auto w-full justify-start gap-3 py-3 text-body"
        >
          {isHeadline ? (
            // The branded "gluten struck out" glyph — the SAME icon the adjacent
            // SafetySignal preview renders for gluten-friendly (AUB-133).
            <WheatStrike
              aria-hidden="true"
              className={cn("size-5 shrink-0", value !== "dispute" && "text-gluten-friendly")}
              strokeWidth={2.25}
            />
          ) : (
            <X aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.25} />
          )}
          Dispute
        </Button>

        <Button
          type="button"
          variant="outline"
          aria-pressed={value === "skip"}
          onClick={() => onAnswer("skip")}
          className={cn(
            "h-auto w-full justify-start gap-3 border-dashed py-3 text-body text-muted-foreground",
            value === "skip" && "bg-muted"
          )}
        >
          <HelpCircle aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.25} />
          Skip (not sure)
        </Button>
      </fieldset>

      <div>
        <Button type="button" variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          Back
        </Button>
      </div>
    </section>
  );
}
