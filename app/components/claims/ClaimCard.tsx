import { motion, useDragControls, useMotionValue, useTransform } from "motion/react";
import type * as React from "react";
import { SafetySignal } from "~/components/SafetySignal";
import { cn } from "~/lib/utils";
import type { ClaimAttribute } from "~/listings/taxonomy";
import {
  CLAIM_ATTRIBUTE_ICONS,
  claimAttributeDescription,
  claimAttributeLabel,
} from "~/trust/summary";
import { SwipeStamp } from "./SwipeStamp";

/**
 * One swipeable claim card. Presentational: the deck owns which card is
 * showing and what an answer does; this card owns the drag gesture, the tilt,
 * the stamps, and the shared card anatomy (icon well + label + description +
 * headline-only safety preview).
 *
 * Gesture rules:
 *   - Drag right = Confirm, left = Dispute; rotation is proportional to drag
 *     (~±12° max) and the matching stamp's opacity tracks drag distance.
 *   - Release past the threshold calls `onSwipe`; under it, the card springs
 *     back (`dragSnapToOrigin`).
 *   - Pointer-downs within {@link EDGE_DEAD_ZONE_PX} of the viewport's left or
 *     right edge never start a drag — the OS edge-swipe back gesture wins there.
 *   - `prefers-reduced-motion`: no drag at all; the deck's fixed button row is
 *     the (always-present) path, and card transitions are plain fades.
 *
 * The card is not focusable and traps nothing: the equal-footing interactive
 * path is the deck's real `<button>` row below the stack.
 */

const HEADLINE = "celiac_safe" as const;

/** Horizontal drag distance (px) past which release commits the answer. */
const SWIPE_THRESHOLD_PX = 96;
/** Release velocity (px/s) that commits a shorter, flicked swipe. */
const SWIPE_VELOCITY = 600;
/** Screen-edge dead zone so card drags never fight the OS back gesture. */
const EDGE_DEAD_ZONE_PX = 24;

/** How far a committed card travels while exiting, and its max tilt. */
const EXIT_X = 560;
const MAX_TILT_DEG = 12;

/**
 * Enter/exit choreography, keyed by the deck's `custom` payloads:
 *   enter custom — "forward" (rises from the peek position) | "back" (the
 *   previous card slides back onto the stack from its exit side).
 *   exit custom — the chosen answer: confirm exits right with tilt, dispute
 *   exits left, skip drops downward and fades (visually distinct, neutral).
 * The reduced-motion variants replace all of it with plain fades.
 */
function cardVariants(reducedMotion: boolean) {
  if (reducedMotion) {
    return {
      enter: { opacity: 0 },
      center: { opacity: 1 },
      exit: { opacity: 0, transition: { duration: 0.15 } },
    };
  }
  return {
    enter: (direction: string) =>
      direction === "back"
        ? { x: -EXIT_X / 3, opacity: 0, rotate: -4 }
        : { y: 12, scale: 0.95, opacity: 0.6 },
    center: { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 },
    exit: (direction: string) => {
      if (direction === "confirm") {
        return { x: EXIT_X, rotate: MAX_TILT_DEG, opacity: 0, transition: { duration: 0.3 } };
      }
      if (direction === "dispute") {
        return { x: -EXIT_X, rotate: -MAX_TILT_DEG, opacity: 0, transition: { duration: 0.3 } };
      }
      // Skip / back: a neutral downward fade — deliberately not a sideways
      // "verdict" exit.
      return { y: 96, opacity: 0, transition: { duration: 0.25 } };
    },
  };
}

export function ClaimCard({
  attribute,
  caption,
  reducedMotion,
  onSwipe,
  custom,
}: {
  attribute: ClaimAttribute;
  /** Host-supplied context line (e.g. "You marked this celiac-safe."). */
  caption?: string | null | undefined;
  reducedMotion: boolean;
  onSwipe: (answer: "confirm" | "dispute") => void;
  /**
   * Variant payload forwarded to the motion element: the deck passes the enter
   * direction ("forward" | "back"); while exiting, `AnimatePresence` clones
   * this card with its own `custom` (the chosen answer), which selects the
   * exit choreography in {@link cardVariants}.
   */
  custom?: string;
}) {
  const isHeadline = attribute === HEADLINE;
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-MAX_TILT_DEG, MAX_TILT_DEG]);
  const confirmOpacity = useTransform(x, [SWIPE_THRESHOLD_PX / 4, SWIPE_THRESHOLD_PX], [0, 1]);
  const disputeOpacity = useTransform(x, [-SWIPE_THRESHOLD_PX, -SWIPE_THRESHOLD_PX / 4], [1, 0]);
  const dragControls = useDragControls();

  const startDrag = (event: React.PointerEvent) => {
    if (reducedMotion) {
      return;
    }
    // Edge dead zones: near the screen edges the OS/browser back gesture owns
    // horizontal swipes — never contest it.
    if (
      event.clientX < EDGE_DEAD_ZONE_PX ||
      event.clientX > window.innerWidth - EDGE_DEAD_ZONE_PX
    ) {
      return;
    }
    dragControls.start(event);
  };

  return (
    <motion.div
      data-testid="claim-card"
      className="relative z-10 touch-pan-y [grid-area:1/1]"
      variants={cardVariants(reducedMotion)}
      custom={custom}
      initial="enter"
      animate="center"
      exit="exit"
      drag={reducedMotion ? false : "x"}
      dragControls={dragControls}
      dragListener={false}
      onPointerDown={startDrag}
      dragSnapToOrigin
      dragElastic={0.9}
      {...(reducedMotion ? {} : { style: { x, rotate } })}
      onDragEnd={(_event, info) => {
        const distance = info.offset.x;
        const flick = Math.abs(info.velocity.x) > SWIPE_VELOCITY && Math.abs(distance) > 24;
        if (distance > SWIPE_THRESHOLD_PX || (flick && distance > 0)) {
          onSwipe("confirm");
        } else if (distance < -SWIPE_THRESHOLD_PX || (flick && distance < 0)) {
          onSwipe("dispute");
        }
      }}
    >
      <div className="relative overflow-hidden rounded-card border border-border bg-card p-card text-card-foreground shadow-sm">
        {/* Decorative pastel wash — never meaning-bearing. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_85%_0%,var(--color-accent-lavender),transparent_55%)] opacity-40 dark:opacity-15"
        />
        <SwipeStamp
          kind="confirm"
          isHeadline={isHeadline}
          dragOpacity={reducedMotion ? undefined : confirmOpacity}
        />
        <SwipeStamp
          kind="dispute"
          isHeadline={isHeadline}
          dragOpacity={reducedMotion ? undefined : disputeOpacity}
        />
        <ClaimCardBody attribute={attribute} caption={caption} />
      </div>
    </motion.div>
  );
}

/**
 * The static card anatomy, shared by the interactive top card and the
 * decorative peek card behind it: brand-soft icon well, display-face label,
 * shared taxonomy description, optional host caption, and — on the headline
 * card only — the "What your answer records" preview (confirm → the Celiac-safe
 * badge, dispute → plain text: a dispute removes a badge, it never awards a
 * lesser one). Fact cards get no safety signal.
 */
export function ClaimCardBody({
  attribute,
  caption,
}: {
  attribute: ClaimAttribute;
  caption?: string | null | undefined;
}) {
  const isHeadline = attribute === HEADLINE;
  const Icon = CLAIM_ATTRIBUTE_ICONS[attribute];
  const label = claimAttributeLabel(attribute);

  return (
    <div className="relative flex min-h-64 flex-col items-center gap-3 text-center">
      <span className="mt-4 inline-flex size-16 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon aria-hidden="true" className="size-8 shrink-0" strokeWidth={2} />
      </span>
      <h3 className="font-display text-title font-semibold text-foreground">{label}</h3>
      <p className="text-body text-muted-foreground">{claimAttributeDescription(attribute)}</p>
      {caption ? <p className="text-caption font-medium text-muted-foreground">{caption}</p> : null}
      {isHeadline ? (
        <div className="mt-auto flex w-full flex-col gap-2 rounded-card border border-border bg-muted/40 p-3 text-left">
          <span className="text-body-sm font-medium text-foreground">What your answer records</span>
          <div className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-1.5 text-body-sm text-muted-foreground">
              Confirm records <SafetySignal state="celiac-safe" />
            </span>
            <span className="text-body-sm text-muted-foreground">
              Dispute counts against the Celiac-safe badge. Enough disputes remove it.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The next card "peeking" from behind the top card so the deck reads as a
 * stack: scaled down, offset, faded, and fully decorative
 * (`aria-hidden`, no pointer events) — it re-renders as the real top card the
 * moment it reaches the front.
 */
export function PeekCard({
  attribute,
  caption,
}: {
  attribute: ClaimAttribute;
  caption?: string | null | undefined;
}) {
  return (
    <div
      aria-hidden="true"
      data-testid="peek-card"
      className={cn(
        "pointer-events-none translate-y-3 scale-95 opacity-60 [grid-area:1/1]",
        "rounded-card border border-border bg-card p-card text-card-foreground shadow-sm"
      )}
    >
      <ClaimCardBody attribute={attribute} caption={caption} />
    </div>
  );
}
