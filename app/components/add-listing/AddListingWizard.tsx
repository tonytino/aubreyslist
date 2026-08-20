import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  ClaimCardDeck,
  type DeckAnswer,
  type DeckAnswerMap,
  emptyDeckAnswers,
} from "~/components/claims/ClaimCardDeck";
import { Button } from "~/components/ui/button";
import type { CreateListingInput } from "~/listings/create-input";
import { parseDuplicateListingError } from "~/listings/dedup-error";
import { LINK_KINDS, type LinkKind } from "~/listings/links";
import { CLAIM_ATTRIBUTES, type ClaimAttribute } from "~/listings/taxonomy";
import { submitVote } from "~/server/attestations/attestations.fn";
import { submitCreateListing } from "~/server/listings/create.fn";
import type { IntakeMode } from "~/server/settings";
import { FindPlaceStep } from "./FindPlaceStep";
import { emptyLinkFieldValues, type LinkFieldValues } from "./ListingLinksFields";
import { ProgressStepper } from "./ProgressStepper";
import { ReviewStep } from "./ReviewStep";

/**
 * The add-a-listing claim wizard (ADR-008). A 3-stage flow that collects a
 * place + the user's confirm/dispute/skip answers for the five GF taxonomy
 * attributes into local state, and defers all server writes to a single final
 * Submit:
 *
 *   0   find the place (Places search or manual entry) — collect, don't create
 *   1   attest — one swipeable {@link ClaimCardDeck} stage covering all five
 *       {@link CLAIM_ATTRIBUTES} (the deck keeps its own "n of 5" indicator)
 *   2   review & submit
 *
 * Deferring the create lets the user attest as they go and commit once. Submit
 * creates the listing, then fires a `submitVote` for every attribute the user
 * actually answered — skip / untouched writes nothing, so a celiac reading the
 * listing later sees an honest "Not yet attested" gap rather than a fabricated
 * verdict. The create still succeeds when all five are skipped.
 *
 * The deck is a controlled component writing into the wizard's local
 * {@link AnswerMap}; completing it hands off straight to ReviewStep (the
 * deck-internal summary stays off here — no double summary). A ReviewStep
 * row's Edit re-enters the deck at that card in single-card mode, as does the
 * review screen's Back (at the last card).
 *
 * All wizard state is ephemeral `useState` (a multi-step form, not shareable/
 * restorable view state) driven by explicit handlers — no `useEffect`-for-data.
 * The create+votes orchestration runs through a single TanStack Query mutation.
 */

/**
 * A user's answer for one attribute. `skip` records nothing (first-class).
 * Aliased from the deck so the wizard, ReviewStep, and ProgressStepper all
 * speak the deck's answer vocabulary — one type shared by both hosts.
 */
export type Answer = DeckAnswer;

/**
 * The collected place, discriminated by intake mode. `places` carries only the
 * Google Place ID (canonical fields resolved server-side, dedup by Place ID);
 * `manual` carries the typed fields. Deferred into state until the final submit.
 */
export type WizardPlace =
  | { mode: "places"; placeId: string; description: string }
  | { mode: "manual"; name: string; address: string; lat: number; lng: number };

/** Map of every attribute → the user's answer (seeded `undefined` = untouched). */
export type AnswerMap = DeckAnswerMap;

const ATTEST_STEP = 1;
const REVIEW_STEP = 2;

/** The last card — where the review screen's Back re-enters the deck. */
const LAST_ATTRIBUTE = CLAIM_ATTRIBUTES[CLAIM_ATTRIBUTES.length - 1];

/** How many attributes the user left un-attested (skip or untouched). */
function countUnattested(answers: AnswerMap): number {
  return CLAIM_ATTRIBUTES.filter((attribute) => !isAttested(answers[attribute])).length;
}

/** An answer is "attested" (and thus written) only when it's confirm or dispute. */
function isAttested(answer: Answer | undefined): answer is "confirm" | "dispute" {
  return answer === "confirm" || answer === "dispute";
}

/** The display name for the collected place (the description, or manual name). */
function placeName(place: WizardPlace): string {
  return place.mode === "places" ? place.description : place.name;
}

/**
 * Build the create-write input from the collected place + typed links. Blank
 * link fields are dropped here — only kinds the user actually filled reach the
 * schema, which requires each URL to be valid http(s).
 */
function toCreateInput(place: WizardPlace, links: LinkFieldValues): CreateListingInput {
  const filled = LINK_KINDS.flatMap((kind: LinkKind) => {
    const url = links[kind].trim();
    return url ? [{ kind, url }] : [];
  });
  const linksInput = filled.length > 0 ? filled : undefined;
  if (place.mode === "places") {
    return { mode: "places", placeId: place.placeId, links: linksInput };
  }
  return {
    mode: "manual",
    name: place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    links: linksInput,
  };
}

export function AddListingWizard({ intakeMode }: { intakeMode: IntakeMode }) {
  const [step, setStep] = useState(0);
  const [place, setPlace] = useState<WizardPlace | null>(null);
  const [links, setLinks] = useState<LinkFieldValues>(emptyLinkFieldValues());
  const [answers, setAnswers] = useState<AnswerMap>(emptyDeckAnswers());
  // When set, the deck opens at this card in single-card Edit mode (a
  // ReviewStep row's Edit, or the review screen's Back → the last card).
  const [editAttribute, setEditAttribute] = useState<ClaimAttribute | null>(null);
  const [submitted, setSubmitted] = useState<{ listingId: string; created: boolean } | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      if (place === null) {
        throw new Error("Choose a place before submitting.");
      }
      const result = await submitCreateListing({ data: toCreateInput(place, links) });
      const listingId = result.listing.id;
      // Record only the answers the user actually made. Skip / untouched writes
      // nothing — the listing keeps an honest "Not yet attested" gap.
      for (const attribute of CLAIM_ATTRIBUTES) {
        const value = answers[attribute];
        if (isAttested(value)) {
          await submitVote({ data: { listingId, attribute, value } });
        }
      }
      return { listingId, created: result.created };
    },
    onSuccess: ({ listingId, created }) => {
      toast.success(created ? "Listing added" : "This place was already listed");
      setSubmitted({ listingId, created });
    },
    // A blocked manual duplicate still surfaces the inline "existing listing"
    // link below (the graceful "already listed" path); the toast complements it.
    onError: (error) => {
      const duplicate = parseDuplicateListingError(error);
      toast.error(
        duplicate
          ? "This restaurant is already listed."
          : "Could not add the listing. Please try again."
      );
    },
  });

  if (submitted !== null && place !== null) {
    return (
      <SuccessScreen
        listingId={submitted.listingId}
        created={submitted.created}
        name={placeName(place)}
        unattestedCount={countUnattested(answers)}
        onReset={() => {
          setStep(0);
          setPlace(null);
          setLinks(emptyLinkFieldValues());
          setAnswers(emptyDeckAnswers());
          setEditAttribute(null);
          setSubmitted(null);
          submit.reset();
        }}
      />
    );
  }

  // Every entry into the deck stage decides its mode explicitly: `null` runs
  // the full 5-card flow; an attribute opens that one card (Edit re-entry).
  const enterDeck = (edit: ClaimAttribute | null) => {
    setEditAttribute(edit);
    setStep(ATTEST_STEP);
  };

  let body: ReactNode;
  if (step === 0 || place === null) {
    body = (
      <FindPlaceStep
        intakeMode={intakeMode}
        place={place}
        links={links}
        onLinkChange={(kind, value) => setLinks((prev) => ({ ...prev, [kind]: value }))}
        onSelect={setPlace}
        onClear={() => setPlace(null)}
        onContinue={() => enterDeck(null)}
      />
    );
  } else if (step === ATTEST_STEP) {
    body = (
      <ClaimCardDeck
        // Remount when the Edit target changes so the deck re-seeds its card
        // position (its per-flow position state is internal by design).
        key={editAttribute ?? "full-deck"}
        answers={answers}
        onAnswer={(attribute, value) => setAnswers((prev) => ({ ...prev, [attribute]: value }))}
        onBack={() => setStep(0)}
        onComplete={() => setStep(REVIEW_STEP)}
        initialAttribute={editAttribute ?? undefined}
      />
    );
  } else {
    body = (
      <ReviewStep
        place={place}
        answers={answers}
        onEditPlace={() => setStep(0)}
        onEditAttribute={(attribute) => enterDeck(attribute)}
        onBack={() => enterDeck(LAST_ATTRIBUTE ?? null)}
        onSubmit={() => submit.mutate()}
        submitting={submit.isPending}
        error={submit.isError ? <SubmitError error={submit.error} /> : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <ProgressStepper
        step={step}
        hasPlace={place !== null}
        answers={answers}
        onNavigate={(next) => (next === ATTEST_STEP ? enterDeck(null) : setStep(next))}
      />
      {body}
    </div>
  );
}

/**
 * Terminal success screen (no stepper). Honest about the gaps: when any
 * attribute was left un-attested it says so, tied to the "attest it later"
 * affordance. Never auto-redirects — the user chooses to view the listing or
 * add another.
 */
function SuccessScreen({
  listingId,
  created,
  name,
  unattestedCount,
  onReset,
}: {
  listingId: string;
  created: boolean;
  name: string;
  unattestedCount: number;
  onReset: () => void;
}) {
  // A places pick can dedup to a listing that already exists (created === false).
  // Be honest about that rather than claiming it was "added" — the attestations
  // the user made are still recorded against the existing listing.
  const attestedCount = CLAIM_ATTRIBUTES.length - unattestedCount;
  return (
    <section
      aria-labelledby="wizard-success-heading"
      className="flex flex-col items-center gap-4 rounded-card border border-border bg-card p-gutter text-center text-card-foreground"
    >
      <span className="inline-flex size-16 items-center justify-center rounded-full bg-celiac-safe-soft text-celiac-safe">
        <CircleCheck aria-hidden="true" className="size-9 shrink-0" strokeWidth={2.25} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 id="wizard-success-heading" className="text-title font-semibold">
          {created ? "Listing added, thanks!" : "This place was already listed"}
        </h2>
        <p className="text-body text-muted-foreground">{name}</p>
        {created ? null : (
          <p className="text-body-sm text-muted-foreground">
            {attestedCount > 0
              ? "We saved your attestations to the existing listing."
              : "It's already on the map. You can attest it any time."}
          </p>
        )}
      </div>
      {unattestedCount > 0 ? (
        <p className="w-full rounded-card border border-border bg-muted/40 p-card text-body-sm text-muted-foreground">
          {unattestedCount} of {CLAIM_ATTRIBUTES.length} attributes stayed "Not yet attested". You
          can attest them any time from the listing.
        </p>
      ) : null}
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <Button asChild className="w-full sm:flex-1">
          <Link to="/listings/$id" params={{ id: listingId }}>
            View your listing
          </Link>
        </Button>
        <Button variant="outline" type="button" onClick={onReset} className="w-full sm:flex-1">
          Add another listing
        </Button>
      </div>
    </section>
  );
}

/**
 * Renders the submit error. A blocked-duplicate error is special-cased:
 * {@link parseDuplicateListingError} recovers the existing listing's id from
 * the message marker (custom error fields don't survive the server-fn RPC
 * boundary), so the error links to the listing that already exists rather than
 * just stating that it does.
 */
function SubmitError({ error }: { error: unknown }) {
  const duplicate = parseDuplicateListingError(error);

  if (duplicate?.existingListingId) {
    return (
      <p role="alert" className="text-body-sm text-incident">
        {duplicate.message}{" "}
        <Link
          to="/listings/$id"
          params={{ id: duplicate.existingListingId }}
          className="underline underline-offset-4"
        >
          View the existing listing
        </Link>
      </p>
    );
  }

  return (
    <p role="alert" className="text-body-sm text-incident">
      {error instanceof Error ? error.message : "Could not add the listing. Please try again."}
    </p>
  );
}
