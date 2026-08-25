import { ArrowLeft, Check, HelpCircle, type LucideIcon, ShieldCheck, X } from "lucide-react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { CLAIM_ATTRIBUTES, type ClaimAttribute } from "~/listings/taxonomy";
import { claimAttributeLabel } from "~/trust/summary";
import { ClaimCard, PeekCard } from "./ClaimCard";
import { DeckProgress } from "./DeckProgress";
import { DeckSummary } from "./DeckSummary";

/**
 * ClaimCardDeck — the one swipeable attestation flow, hosted by both the
 * add-listing wizard (deferred answers, completion hands off to the wizard's
 * ReviewStep) and the listing-detail Claims tab (immediate writes,
 * deck-internal summary). One card per {@link CLAIM_ATTRIBUTES} attribute, in
 * taxonomy order.
 *
 * Presentational and host-agnostic: the deck renders cards and reports answers
 * via `onAnswer`; it never writes to the server and never owns the answer map
 * (the host does — the deck is a controlled component).
 *
 * Interaction contract:
 *   - Swipe right = Confirm, left = Dispute; the fixed bottom button row
 *     (Dispute / "Not sure" / Confirm — real `<button>`s, ≥44px targets) is the
 *     equal-footing path and triggers the same card exits.
 *   - Skip ("Not sure") is first-class and guilt-free — it exits with a
 *     distinct neutral downward fade, never a sideways verdict exit.
 *   - Back replays the previous card onto the stack; on the first card it
 *     calls `onBack` (hidden when the host passes none).
 *   - An `aria-live="polite"` region announces card position and recorded
 *     answers, mirroring the ProgressStepper live-region pattern.
 *   - `prefers-reduced-motion` swaps all swipes/tilts/springs for fades and
 *     disables drag entirely (the button row is always present).
 *
 * Single-card (Edit) mode: when `initialAttribute` is set — or a summary row's
 * Edit is pressed — the deck shows just that card and resolves (back to the
 * summary, or `onComplete`) after one answer, instead of marching the user
 * back through cards they already answered.
 */

export type DeckAnswer = "confirm" | "dispute" | "skip";

/** Every attribute → the user's answer; `undefined` = untouched. */
export type DeckAnswerMap = Record<ClaimAttribute, DeckAnswer | undefined>;

/** Fresh all-untouched answer map (exported for hosts + tests). */
export function emptyDeckAnswers(): DeckAnswerMap {
  return Object.fromEntries(
    CLAIM_ATTRIBUTES.map((attribute) => [attribute, undefined])
  ) as DeckAnswerMap;
}

const HEADLINE = "celiac_safe" as const;

export interface ClaimCardDeckProps {
  /** The host-owned answer map (controls seeding + the progress dots). */
  answers: DeckAnswerMap;
  /** Called for every resolution — confirm, dispute, and skip alike. */
  onAnswer: (attribute: ClaimAttribute, answer: DeckAnswer) => void;
  /** Back pressed on the first card. Omit to hide Back there (detail host). */
  onBack?: (() => void) | undefined;
  /** The last card resolved and there is no deck-internal summary to show. */
  onComplete?: (() => void) | undefined;
  /** Show the deck-internal end-state summary (detail host only). */
  showSummary?: boolean;
  /** The summary's Done action (e.g. close the sheet). */
  onDone?: (() => void) | undefined;
  /** Start at this card in single-card Edit mode (ReviewStep row Edit). */
  initialAttribute?: ClaimAttribute | undefined;
  /** Optional per-card context line, e.g. "You marked this celiac-safe." */
  cardCaption?: ((attribute: ClaimAttribute) => string | null) | undefined;
}

export function ClaimCardDeck({
  answers,
  onAnswer,
  onBack,
  onComplete,
  showSummary = false,
  onDone,
  initialAttribute,
  cardCaption,
}: ClaimCardDeckProps) {
  const initialIndex = initialAttribute ? CLAIM_ATTRIBUTES.indexOf(initialAttribute) : 0;
  const [index, setIndex] = useState(initialIndex >= 0 ? initialIndex : 0);
  const [view, setView] = useState<"cards" | "summary">("cards");
  // Single-card Edit mode: answer (or Back) resolves immediately.
  const [single, setSingle] = useState(initialAttribute !== undefined);
  // The exit choreography for the outgoing card (AnimatePresence `custom`) and
  // the enter choreography for the incoming one.
  const [lastExit, setLastExit] = useState<DeckAnswer | "back">("skip");
  const [navDirection, setNavDirection] = useState<"forward" | "back">("forward");
  const [announcement, setAnnouncement] = useState("");
  const reducedMotion = useReducedMotion() ?? false;

  const cardLine = (cardIndex: number) => {
    const attribute = CLAIM_ATTRIBUTES[cardIndex];
    return attribute
      ? `Card ${cardIndex + 1} of ${CLAIM_ATTRIBUTES.length} · ${claimAttributeLabel(attribute)}`
      : "";
  };

  /** Resolve the flow end: internal summary (detail) or host hand-off (wizard). */
  const finish = () => {
    if (showSummary) {
      setView("summary");
    } else {
      onComplete?.();
    }
  };

  const handleAnswer = (answer: DeckAnswer) => {
    const attribute = CLAIM_ATTRIBUTES[index];
    if (attribute === undefined) {
      return;
    }
    onAnswer(attribute, answer);
    setLastExit(answer);
    setNavDirection("forward");
    const recorded =
      answer === "skip"
        ? "Recorded: Skipped"
        : answer === "confirm"
          ? "Recorded: Confirm"
          : "Recorded: Dispute";
    const nextIndex = index + 1;
    if (single || nextIndex >= CLAIM_ATTRIBUTES.length) {
      setSingle(false);
      setAnnouncement(`${recorded} · All ${CLAIM_ATTRIBUTES.length} cards done`);
      finish();
      return;
    }
    setIndex(nextIndex);
    setAnnouncement(`${recorded} · ${cardLine(nextIndex)}`);
  };

  const handleBack = () => {
    // Editing a single card: Back returns to the summary/review unchanged.
    if (single) {
      setSingle(false);
      finish();
      return;
    }
    if (index === 0) {
      onBack?.();
      return;
    }
    setLastExit("back");
    setNavDirection("back");
    setIndex(index - 1);
    setAnnouncement(cardLine(index - 1));
  };

  const handleEdit = (attribute: ClaimAttribute) => {
    const position = CLAIM_ATTRIBUTES.indexOf(attribute);
    if (position < 0) {
      return;
    }
    setSingle(true);
    setNavDirection("forward");
    setLastExit("skip");
    setIndex(position);
    setView("cards");
    setAnnouncement(cardLine(position));
  };

  if (view === "summary") {
    return (
      <div className="flex flex-col gap-4">
        <DeckSummary answers={answers} onEdit={handleEdit} onDone={onDone} />
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    );
  }

  const attribute = CLAIM_ATTRIBUTES[index] ?? HEADLINE;
  const isHeadline = attribute === HEADLINE;
  const nextAttribute = single ? undefined : CLAIM_ATTRIBUTES[index + 1];
  const caption = cardCaption?.(attribute) ?? null;
  const showBack = single || index > 0 || onBack !== undefined;

  return (
    // Width-capped ~28rem and centered from `sm:` up so the cards keep a
    // thumbable aspect inside wider host columns.
    <section
      aria-label="Attest what you know"
      className="mx-auto flex w-full flex-col gap-4 sm:max-w-md"
    >
      <DeckProgress index={index} answers={answers} />

      {/* The stack: the peek card sits behind; AnimatePresence swaps the top
          card with answer-directional exits (popLayout frees the exiting card
          from the grid so the next one takes its slot immediately).
          `overflow-x-clip` keeps drags and the sideways exit flights from ever
          widening the page (no horizontal overflow — styling.md hard rule);
          vertical overflow stays visible for the skip drop. */}
      <div className="relative grid overflow-x-clip">
        {nextAttribute !== undefined ? (
          <PeekCard attribute={nextAttribute} caption={cardCaption?.(nextAttribute) ?? null} />
        ) : null}
        <AnimatePresence custom={lastExit} initial={false} mode="popLayout">
          <ClaimCard
            key={attribute}
            attribute={attribute}
            caption={caption}
            reducedMotion={reducedMotion}
            onSwipe={handleAnswer}
            custom={navDirection}
          />
        </AnimatePresence>
      </div>

      <p className="text-center text-body-sm text-muted-foreground">
        Skip anything you're not sure of — an honest gap beats a guess.
      </p>

      {/* The equal-footing accessibility path: always-visible native buttons
          (≥44px targets) that trigger the same exits as the swipes. */}
      <div className="flex items-stretch gap-2">
        <AnswerButton label="Dispute" icon={X} onClick={() => handleAnswer("dispute")} />
        <AnswerButton
          label="Not sure"
          icon={HelpCircle}
          onClick={() => handleAnswer("skip")}
          className="border-dashed text-muted-foreground"
        />
        <AnswerButton
          label="Confirm"
          icon={isHeadline ? ShieldCheck : Check}
          iconClassName={isHeadline ? "text-celiac-safe" : undefined}
          onClick={() => handleAnswer("confirm")}
        />
      </div>

      {showBack ? (
        <div>
          <Button type="button" variant="ghost" onClick={handleBack} className="min-h-11 gap-1.5">
            <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
            Back
          </Button>
        </div>
      ) : null}

      {/* Polite announcements — position on advance, the recorded answer on
          resolution — mirroring the ProgressStepper live-region pattern. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

/**
 * One button of the fixed Dispute / "Not sure" / Confirm row. A real native
 * `<button>` (keyboard/focus/disabled semantics for free) with an icon + an
 * always-visible text label — meaning never rests on colour alone.
 */
function AnswerButton({
  label,
  icon: Icon,
  iconClassName,
  onClick,
  className,
}: {
  label: string;
  icon: LucideIcon;
  iconClassName?: string | undefined;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className={cn("h-auto min-h-11 flex-1 gap-1.5 py-2.5 text-body", className)}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-5 shrink-0", iconClassName)}
        strokeWidth={2.25}
      />
      {label}
    </Button>
  );
}
