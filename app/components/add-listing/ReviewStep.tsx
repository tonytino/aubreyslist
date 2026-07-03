import { ArrowLeft, HelpCircle, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { SafetySignal } from "~/components/SafetySignal";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CLAIM_ATTRIBUTES, type ClaimAttribute } from "~/listings/taxonomy";
import { CLAIM_ATTRIBUTE_ICONS, claimAttributeLabel } from "~/trust/summary";
import type { Answer, AnswerMap, WizardPlace } from "./AddListingWizard";

/**
 * Review & submit. One row per attribute, honest about what each answer records:
 *
 *   headline confirm/dispute → a `SafetySignal` chip (celiac-safe / gluten-friendly)
 *   fact confirm/dispute     → a per-attribute icon chip in a neutral, non-safety
 *                              tint (brand-soft "Confirmed" / muted "Disputed") so a
 *                              plain fact never borrows the celiac-safe/GF safety colours
 *   skip / untouched         → a dashed "Not yet attested" pill, for ALL attributes
 *
 * Every row has an Edit that jumps back to its step (the place row → step 0). The
 * footer reiterates that skipped attributes record nothing, tied to the fact that
 * celiacs rely on those honest gaps.
 */

const HEADLINE = "celiac_safe_vs_gluten_friendly" as const;

function placeName(place: WizardPlace): string {
  return place.mode === "places" ? place.description : place.name;
}

function placeDetail(place: WizardPlace): string {
  return place.mode === "places"
    ? "Google Place · dedup by Place ID"
    : `${place.address} · Manual entry`;
}

export function ReviewStep({
  place,
  answers,
  onEditPlace,
  onEditAttribute,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  place: WizardPlace;
  answers: AnswerMap;
  onEditPlace: () => void;
  onEditAttribute: (attribute: ClaimAttribute) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-title font-semibold">Review &amp; submit</h2>
        <p className="text-body text-muted-foreground">
          Check what you're adding. You can edit any answer before submitting.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-body-sm font-medium text-muted-foreground">
            Selected place
          </CardTitle>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-body font-semibold text-foreground">{placeName(place)}</span>
              <span className="text-body-sm text-muted-foreground">{placeDetail(place)}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onEditPlace}
              aria-label="Edit selected place"
              className="ml-auto shrink-0 gap-1.5"
            >
              <Pencil aria-hidden="true" className="size-4 shrink-0" />
              Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col">
          {CLAIM_ATTRIBUTES.map((attribute) => (
            <div
              key={attribute}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-3"
            >
              <span className="min-w-0 flex-1 text-body font-medium text-foreground">
                {claimAttributeLabel(attribute)}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <ReviewOutcome attribute={attribute} answer={answers[attribute]} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditAttribute(attribute)}
                  aria-label={`Edit ${claimAttributeLabel(attribute)}`}
                  className="gap-1.5"
                >
                  <Pencil aria-hidden="true" className="size-4 shrink-0" />
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-body-sm text-muted-foreground">
        Skipped attributes stay "Not yet attested" and record nothing. Celiacs rely on those honest
        gaps — only attest what you actually know.
      </p>

      {error}

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
        <Button type="button" onClick={onSubmit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit listing"}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          Back
        </Button>
      </div>
    </section>
  );
}

/** The per-row outcome chip/text, differentiated by attribute + answer. */
function ReviewOutcome({
  attribute,
  answer,
}: {
  attribute: ClaimAttribute;
  answer: Answer | undefined;
}) {
  if (answer === "confirm" || answer === "dispute") {
    if (attribute === HEADLINE) {
      return <SafetySignal state={answer === "confirm" ? "celiac-safe" : "gluten-friendly"} />;
    }
    return <FactOutcomeChip attribute={attribute} confirmed={answer === "confirm"} />;
  }
  return <UnattestedPill />;
}

/**
 * A non-headline fact outcome: a per-attribute icon chip that DELIBERATELY avoids
 * the celiac-safe green / gluten-friendly amber safety tokens (honesty — a plain
 * fact must never read as a safety verdict). Confirmed uses a neutral-positive
 * brand tint, Disputed a muted/neutral one. Colour + icon + visible outcome word,
 * with the icon `aria-hidden` so the meaning lives in the text.
 */
function FactOutcomeChip({
  attribute,
  confirmed,
}: {
  attribute: ClaimAttribute;
  confirmed: boolean;
}) {
  const Icon = CLAIM_ATTRIBUTE_ICONS[attribute];
  // `text-brand-strong` (not `text-brand`) so the chip clears WCAG AA on the
  // light `brand-soft` fill in BOTH themes (dark `text-brand` on `brand-soft`
  // is only 3.78:1); matches how brand-soft is paired elsewhere in the app.
  const tint = confirmed ? "bg-brand-soft text-brand-strong" : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-chip px-2.5 py-1 text-body-sm font-medium ${tint}`}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {confirmed ? "Confirmed" : "Disputed"}
    </span>
  );
}

/** The honest, non-alarming "no answer recorded" pill (dashed / neutral). */
function UnattestedPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-chip border border-dashed border-muted-foreground/60 px-2.5 py-1 text-body-sm text-muted-foreground">
      <HelpCircle aria-hidden="true" className="size-4 shrink-0" />
      Not yet attested
    </span>
  );
}
