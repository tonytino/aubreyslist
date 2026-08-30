import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  CircleDashed,
  Clock,
  LoaderCircle,
  LocateFixed,
  Plus,
  RotateCw,
  Search,
} from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { BotProvenanceLabel } from "~/components/listing/BotProvenanceLabel";
import { FAVORITE_OVERLAY_CHROME, FavoriteButton } from "~/components/listing/FavoriteButton";
import { HappyPatrons } from "~/components/listing/ListingActivity";
import {
  CardLocationLine,
  cardLocationParts,
  type RestaurantCardVM,
} from "~/components/listing/ListingCard";
import { SafetySignal, type SafetyState, safetyIcon, safetyLabel } from "~/components/SafetySignal";
import { SCROLL_FADE_RIGHT } from "~/components/scroll-fade";
import { prefersReducedMotion } from "~/lib/motion";
import { cn } from "~/lib/utils";
import type { MapLoadMore } from "~/listings/use-map-pages";
import { ACTIVITY_NAME_CLARIFIER } from "~/trust/summary";

/**
 * Shared presentational pieces of the directory Map view: the safety-pin
 * styling, the pin button, the bottom mini-card carousel, and the recenter
 * FAB. Both map paths render these — the real Google map
 * (`DirectoryMapLive.tsx`, key present) and the stylized CSS-placeholder
 * fallback (`DirectoryMap.tsx`, key absent) — so the safety-signal visuals and
 * accessible names can never drift between them.
 *
 * Safety-correctness invariant: a pin carries a safety signal (colour + icon +
 * label), so a pin must never visually float over a different restaurant's
 * card — a mis-associated safety signal is a real harm (e.g. a red incident
 * pin bleeding onto a celiac-safe card). Enforced two ways: the carousel sits
 * at `z-10` above the pins (`z-1`/`z-6` in the placeholder; the Google map
 * canvas is a `z-0`-clamped sibling in the live path) and draws an opaque
 * background band, so any low pin hides behind the band instead of over a
 * card. The band's right-edge fade is an overlay ON that opaque fill, never a
 * mask applied to it — a mask would thin the fill and let a low pin bleed
 * through the very edge the fade decorates.
 *
 * Accessibility: every pin and mini-card is a real `<button>`; the pin's
 * visible content is decorative and its accessible name is the restaurant name
 * + its safety state — with a recent incident folded in (`pinAccessibleName`),
 * since `aria-label` hides button content from AT — so the safety meaning is
 * never colour-only and never sighted-only. The selected pin/mini-card carry
 * `aria-pressed` in addition to the visual ring/border.
 *
 * Numbered-pins preview variant (numbered pins ↔ numbered cards): the pin dot
 * shows the entry's 1-based index in the current `entries` order, and each
 * mini-card leads its name row with the matching index chip — a sighted
 * correlation aid between a pin and its card. The number is visual only: it
 * never enters an accessible name (indices reshuffle on every filter/sort, so
 * a spoken number would be meaningless to AT), and the safety icon reaches
 * sighted users via the card's `SafetySignal` chip row — the icon not living
 * inside the dot is this variant's deliberate tradeoff.
 */

/** One map entry: the presentational VM plus the real coordinates to place. */
export interface DirectoryMapEntry {
  vm: RestaurantCardVM;
  lat: number;
  lng: number;
}

/**
 * Chrome shared by the map's floating controls — the recenter FAB, the
 * carousel's "Load more" card, and the "Search near here" pill: elevation,
 * the house focus ring, and a motion-gated colour transition. Fills stay
 * per-control: the neutral surface pair for controls over the band, the
 * pinned `primary` pair for the pill over map tiles.
 */
const MAP_CONTROL_SURFACE =
  "shadow-md motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring";

/**
 * Rendered height of the opaque carousel band in px — the ONE retune point
 * when the mini-cards change size. The scroller is the box measured here: it
 * owns the fill and the vertical padding, while its positioning shell adds no
 * box of its own and the edge fade is `absolute inset-y-0`. Summed top to
 * bottom:
 *
 * ```
 *   12  scroller pt-3
 *    1  card border-top
 *    8  card py-2
 *   20  name row (the 20px index chip / the 20px text-body-sm line)
 *   18  location line (mt-0.5 + a 16px text-caption line)
 *   36  signals row (mt-1.5 + min-h-[30px], the badge family's height)
 *   33  meta row (mt-2 + 1px divider + pt-2 + a 16px text-caption line)
 *    8  card py-2
 *    1  card border-bottom
 *   12  scroller pb-3
 *  ---
 *  149
 * ```
 *
 * The selected card compensates its extra border with `px-[11px] py-[7px]`, so
 * selecting never changes the band's height. Derived from this constant: the
 * live map's `FIT_PADDING.bottom` and selection-pan offset
 * (`DirectoryMapLive.tsx`) and the recenter FAB's `bottom-[161px]` (band + a
 * 12px gap — Tailwind can't interpolate a JS constant into a class, so that
 * one is restated below and pinned by a test).
 */
export const CAROUSEL_BAND_PX = 149;

/**
 * Invoke `onUserSelect` exactly when a selection change was caused by a user
 * tap on a pin/mini-card — the ONE discriminator shared by both selection-sync
 * surfaces (the carousel's scroll-into-view and the live map's pan), so their
 * notion of "user selection" can never drift. `selectedId` itself carries no
 * cause, so the cause is inferred from the transition; skipped by design:
 *
 * - the first selection seen while `ready` — the mount value (the route's
 *   default-first or a URL-restored `?sel=`), and a restored `?sel=` that
 *   resolves from null once its URL-seeded page lands;
 * - any change while `!ready` (the live map instance not created yet): nothing
 *   is recorded, so when `ready` flips the pending selection counts as
 *   initial, never replayed;
 * - a change whose PREVIOUS selection is no longer in `entries`: that is the
 *   route falling back to the default selection after a filter change, not a
 *   tap — the camera/scroll must not chase it;
 * - a change landing in the same commit as a different entry-id sequence: a
 *   tap never changes which cards are shown, so that is a result-set change
 *   resetting the selection (the navigation strips `?sel=`), even when the
 *   previously selected listing survives into the new set. Compared as an id
 *   sequence, not array identity: a content-only refresh (background
 *   revalidation) keeps the sequence, so a tap batched with one still
 *   animates.
 */
export function useUserSelectionChange(
  ready: boolean,
  entries: readonly DirectoryMapEntry[],
  selectedId: string | null,
  onUserSelect: (id: string) => void
): void {
  const prevSelected = useRef<string | null>(null);
  const prevIds = useRef<readonly string[] | null>(null);
  useEffect(() => {
    if (!ready) return;
    const prev = prevSelected.current;
    prevSelected.current = selectedId;
    const ids = entries.map((entry) => entry.vm.id);
    const before = prevIds.current;
    prevIds.current = ids;
    const setChanged =
      before !== null && (before.length !== ids.length || before.some((id, i) => id !== ids[i]));
    if (!selectedId || prev === null || prev === selectedId) return;
    if (setChanged) return;
    if (!ids.includes(prev)) return;
    onUserSelect(selectedId);
  }, [ready, entries, selectedId, onUserSelect]);
}

/**
 * Pin-local dot classes per safety state: the solid fill plus its
 * `*-foreground` icon colour (the same pairing `SafetySignal`'s solid variant
 * uses, so icon-on-fill contrast is token-managed, never hardcoded white).
 * Only these live here — the icon shape and label come from `SafetySignal`'s
 * state config (`safetyIcon` / `safetyLabel`), the one source of the
 * state → shape + wording mapping.
 */
const PIN_FILLS: Record<SafetyState, string> = {
  "celiac-safe": "bg-celiac-safe text-celiac-safe-foreground",
  stale: "bg-stale text-stale-foreground",
  incident: "bg-incident text-incident-foreground",
};

/**
 * The no-verdict pin — neutral, unlabelled, never a fake verdict. Covers both
 * an unattested listing and a disputed headline claim: the two are
 * indistinguishable by design, so neither gets a safety label.
 * `CircleDashed` (an "unknown" ring) is deliberately unshareable with any
 * verdict glyph: at dot size a shield outline reads celiac-safe under
 * greyscale/CVD, so this state must not borrow `ShieldCheck`. `text-background`
 * keeps the icon legible on the fill in BOTH themes: near-white on the mid-grey
 * light fill, near-black on the dark fill.
 *
 * `pin-unattested` is a dedicated token pair (app/styles/app.css), not the
 * global `muted-foreground` that body text everywhere depends on. Dark
 * `muted-foreground` (L0.72) sits ~2.5:1 against the pin's white halo, merging
 * dot and halo over dark tiles; the token's dark value keeps the same neutral
 * hue at L0.62 — ~3.6:1 halo-vs-fill (≥3:1 non-text) while the near-black
 * index number keeps ~5.2:1 on the fill (AA). Its light value matches light
 * `muted-foreground`, so light mode is unchanged.
 */
const UNATTESTED_PIN = {
  fill: "bg-pin-unattested text-background",
  Icon: CircleDashed,
  /** No safety wording at all — there is no verdict to announce. */
  label: null,
} as const;

export function pinStyleFor(state: SafetyState | null) {
  if (!state) return UNATTESTED_PIN;
  // `Icon` stays in the style object even though the pin dot draws the index
  // number, not the icon — it keeps the state → shape mapping wired for
  // icon-pin rendering.
  return { fill: PIN_FILLS[state], Icon: safetyIcon(state), label: safetyLabel(state) };
}

/**
 * Typography for the pin/card index number — one source for both surfaces so
 * they always read as the same number. `tabular-nums` keeps digit widths
 * stable; two-digit indices drop to 10px so "12" still fits the 24px dot's
 * ~20px interior (and the mini-card's matching 20px chip).
 */
function indexNumberClass(index: number): string {
  return `font-bold leading-none tabular-nums ${index > 9 ? "text-[10px]" : "text-caption"}`;
}

/**
 * The ONE incident add-on gate: a recent incident riding any non-incident
 * headline (a `null` headline included) both decorates the pin dot and is
 * appended to the accessible name. `pinAccessibleName` and the badge render
 * in `MapPinButton` must share this predicate, so the spoken and the visible
 * incident signal can never disagree.
 */
function showsIncidentAddOn(vm: RestaurantCardVM): boolean {
  return vm.hasRecentIncident && vm.safetyState !== "incident";
}

/**
 * The ONE accessible-name construction for both the pin and the mini-card
 * (`aria-label` overrides button content, so anything visual-only inside —
 * like the incident add-on chip — is invisible to AT unless folded in here).
 * A recent incident is appended per {@link showsIncidentAddOn}: what sighted
 * users see (headline chip + red incident chip) is exactly what screen
 * readers hear. A `null` state contributes no safety wording — sighted users
 * see no badge either.
 */
function pinAccessibleName(vm: RestaurantCardVM): string {
  const label = pinStyleFor(vm.safetyState).label;
  const parts = [vm.name, ...(label === null ? [] : [label])];
  if (showsIncidentAddOn(vm)) {
    parts.push(safetyLabel("incident"));
  }
  return parts.join(", ");
}

/**
 * The mini-card's accessible name: the shared pin name, the location the card
 * shows sighted users, and — for a bot-suggested listing with no verdict — the
 * provenance from its trust row. The browse list card exposes the same context
 * to AT. Card-only on purpose: pin announcements stay terse.
 *
 * `aria-label` overrides button content, so the location is announced only
 * because it is folded in here. Comma-joined, never the visual middot: a screen
 * reader has no useful reading of "·".
 */
function cardAccessibleName(vm: RestaurantCardVM): string {
  const parts = [pinAccessibleName(vm), ...cardLocationParts(vm)];
  if (!vm.safetyState && vm.suggestedByBot) parts.push("suggested by Aubrey's Bot");
  // The meta row's activity line, which `aria-label` would otherwise hide.
  // A dated line gets the short clarifier appended, because "Updated 3 days
  // ago" announced right after a safety label is the one phrasing that could
  // be heard as a verification. The empty state asserts nothing, so it stays
  // bare rather than adding a sentence to every unattested card in the band.
  parts.push(vm.activity.updatedLabel);
  if (vm.activity.hasActivity) parts.push(ACTIVITY_NAME_CLARIFIER);
  // The meta row's right slot. Sighted users see a glyph + a bare number; AT
  // must hear the noun, because "4" announced right after a safety label is
  // exactly the ambiguity ADR-007 forbids. Absent at zero, like the chip.
  if (vm.activity.happyPatronsLabel !== null) parts.push(vm.activity.happyPatronsLabel);
  return parts.join(", ");
}

/**
 * The safety pin itself — an accessible `<button>` whose name carries the
 * restaurant + its safety state (never colour alone). The visible pin is a
 * 24px micro-dot (safety-state colour fill + the entry's 1-based index
 * number), centred inside a 44px transparent button so the tap target stays
 * finger-sized (WCAG 2.5.5 / the same `size-11` the recenter FAB uses) while
 * the map reads uncluttered. The number renders in the per-state
 * `*-foreground` token on the fill, so number-on-fill contrast stays
 * token-managed.
 *
 * The halo is `border-white` on purpose, not `border-surface`: its job is
 * dot-vs-tile separation, so it must stay light over dark-mode map tiles
 * (where `surface` goes near-black and would vanish). In light mode the
 * strong fill separates the dot from light tiles; in dark mode the white halo
 * does (white vs Google's dark tiles ≫ 3:1).
 *
 * Positioning is the caller's job: the placeholder projects the button with
 * `absolute` + `left`/`top` percentages; the live map wraps it in an
 * `<AdvancedMarker>` anchored at the true lat/lng (there the marker carries
 * the z-order, so no extra classes). Both centre the button on the
 * coordinate, so the dot inside is centred too.
 */
export function MapPinButton({
  vm,
  index,
  selected,
  onSelect,
  className,
  style,
}: {
  vm: RestaurantCardVM;
  /**
   * 1-based position in the current entries order — the visible pin ↔ card
   * correlation number. Visual only; never part of the accessible name.
   */
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Positioning/stacking utilities appended by the caller (may be empty). */
  className?: string;
  /** Runtime-computed positioning (the placeholder's projected left/top). */
  style?: CSSProperties;
}) {
  const pin = pinStyleFor(vm.safetyState);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={pinAccessibleName(vm)}
      onClick={() => onSelect(vm.id)}
      // Runtime-computed left/top from the projection — the sanctioned
      // inline-style exception (dynamic positioning). Undefined on the live map.
      {...(style ? { style } : {})}
      className={`flex size-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring${
        className ? ` ${className}` : ""
      }`}
    >
      {/* The visual micro-dot. Selected SIZE is state, not motion — the scale
          is unconditional and only the transition is motion-gated, so
          reduced-motion users still see a clearly larger selected dot. */}
      <span
        className={`relative flex size-6 items-center justify-center rounded-full border-2 border-white shadow-md motion-safe:transition-transform ${
          pin.fill
        }${selected ? " scale-125 ring-4 ring-brand/50" : ""}`}
      >
        {/* The correlation number (visual only — `aria-label` on the button
            already hides content from AT; aria-hidden makes that explicit). */}
        <span aria-hidden="true" className={indexNumberClass(index)}>
          {index}
        </span>
        {/* Recent-incident add-on (the shared `showsIncidentAddOn` gate): the
            dot keeps its headline fill and gains this `incident`-token badge
            — the pin-scale mirror of the card's headline chip + incident
            add-on chip, so recent harm never reads clean on the map. A corner
            badge dot, not a second ring: the selected state already owns the
            ring treatment (`ring-4 ring-brand/50`), which a full incident-red
            ring would collide with. Its `border-2` white ring matches the
            dot's own halo weight, so the badge still separates from the fill
            under greyscale/CVD — the incident red is near-isoluminant with
            the celiac-safe fill. Visual-only and aria-hidden:
            `pinAccessibleName` already folds the incident into the button's
            name, so AT hears exactly what this shows. It renders inside the
            pin button, so the carousel-above-pins safety invariant is
            untouched. */}
        {showsIncidentAddOn(vm) ? (
          <span
            aria-hidden="true"
            data-testid="pin-incident-dot"
            className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-white bg-incident"
          />
        ) : null}
      </span>
    </button>
  );
}

/** Clearance between the top of the carousel band and the recenter FAB, in px. */
export const RECENTER_FAB_GAP_PX = 12;

/**
 * Recenter FAB. In the live map path `onClick` re-fits the camera to the
 * current pins; in the CSS-placeholder fallback it is passed no handler and
 * stays an unwired affordance. `bottom-[161px]` = {@link CAROUSEL_BAND_PX} +
 * {@link RECENTER_FAB_GAP_PX}, restated as a literal because Tailwind arbitrary
 * values can't interpolate a JS constant; a test pins the two together.
 */
export function RecenterFab({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label="Recenter map"
      {...(onClick ? { onClick } : {})}
      className={`absolute bottom-[161px] right-4 z-[11] inline-flex size-11 items-center justify-center rounded-full border border-border bg-surface text-brand-strong hover:bg-brand-soft ${MAP_CONTROL_SURFACE}`}
    >
      <LocateFixed className="size-5" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}

/**
 * "Search near here" pill — presentational only; the live map wires it (the
 * placeholder path has no camera, so it never renders one). Top-center over
 * the canvas at `z-[5]`: above the `z-0`-clamped map, below the `z-10`
 * carousel band, so the z-order safety invariant holds. The pinned `primary`
 * pair keeps the label AA over light and dark tiles (styling.md); `min-w` is
 * sized to the resting label so the busy swap never changes the pill's
 * width; the enter animation is motion-gated. Busy: `aria-busy` +
 * `aria-disabled` + a click guard, never `disabled` — focus must stay on the
 * control — with the spinner and label at full opacity.
 */
export function SearchAreaPill({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-busy={pending}
      aria-disabled={pending}
      onClick={() => {
        if (!pending) onClick();
      }}
      className={`absolute left-1/2 top-3 z-[5] inline-flex min-w-44 -translate-x-1/2 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:ring-offset-2 motion-safe:animate-in fade-in-0 slide-in-from-top-2 ${MAP_CONTROL_SURFACE}`}
    >
      {pending ? (
        <LoaderCircle
          className="size-4 motion-safe:animate-spin"
          strokeWidth={2.25}
          aria-hidden="true"
        />
      ) : (
        <Search className="size-4" strokeWidth={2.25} aria-hidden="true" />
      )}
      {pending ? "Searching…" : "Search near here"}
    </button>
  );
}

/**
 * Scroll the carousel so `card` lands flush with the band's left content
 * edge (the card's offset minus the band's own left padding) — shared by the
 * selection sync, the append-scroll, and the deep-link restore. Never
 * `scrollIntoView`: that walks every scroll ancestor (so it can move the
 * page), and its options object is unreliable in mobile Safari — a direct
 * `scrollTo` on the one scroller is the only container this may ever move.
 * Default behavior is smooth only when motion is allowed; the restore passes
 * an explicit "instant" (a restored position is state, not motion).
 * jsdom reports no computed padding; `|| 0` keeps the fallback explicit.
 */
function scrollCardFlushLeft(
  container: HTMLDivElement,
  card: HTMLDivElement,
  behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth"
): void {
  const paddingLeft = Number.parseFloat(getComputedStyle(container).paddingLeft) || 0;
  container.scrollTo({
    left: Math.max(0, card.offsetLeft - paddingLeft),
    behavior,
  });
}

/**
 * Convert a dominant-vertical wheel step into the band's `scrollLeft` delta,
 * normalizing `deltaMode` so a step feels the same regardless of the input
 * device's units: `DOM_DELTA_LINE` (mouse-wheel "lines") scales by 40px/line
 * — Firefox fires ~3 lines/notch, so 3 × 40 = 120px/notch, matching a
 * Chromium pixel-mode notch (~100-120px) rather than undershooting it at a
 * literal 16px line-height; `DOM_DELTA_PAGE` scales by the band's own width
 * (a "page" of horizontal scroll); pixel deltas (`DOM_DELTA_PIXEL`,
 * trackpads) pass through unchanged.
 */
function normalizedWheelDelta(event: WheelEvent, clientWidth: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 40;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * clientWidth;
  return event.deltaY;
}

/**
 * Attaches the native wheel listener that lets a plain vertical mouse wheel
 * drive the band, which the React `onWheel` prop below cannot do: React 17+
 * delegates its synthetic `wheel` listener from the root as a `passive`
 * listener (to keep the page scroll-perf path unblocked by default), so
 * `preventDefault()` inside a React `onWheel` handler is silently ignored —
 * only a listener attached with `{ passive: false }` can actually cancel the
 * event. Hence a plain `useEffect` + `addEventListener` here instead of a
 * second prop. Assumes the container renders unconditionally once mounted
 * (the scroller inside `MapCarousel`'s shell never toggles away): the effect
 * attaches once
 * against `containerEl.current` and never re-runs to chase a later-arriving
 * ref, since `containerEl` itself is a stable ref object.
 *
 * Pass-throughs (each returns without touching the event, letting the
 * browser's default handling run):
 * - the band doesn't overflow — nothing to scroll, and cancelling would only
 *   eat the page's own scroll for no reason;
 * - `ctrlKey` or `metaKey` — ctrl+wheel (all platforms) and Firefox/macOS
 *   cmd+scroll are browser page-zoom gestures (also how trackpad pinch-zoom
 *   is delivered), never data for this carousel to consume; remapping them
 *   to horizontal scroll would suppress an accessibility gesture;
 * - `shiftKey` — the browser already remaps vertical wheel to horizontal
 *   scroll on shift (Chrome via `deltaX`, Firefox natively); converting again
 *   on top of that would double the distance;
 * - `deltaX` already dominant — a trackpad's horizontal pan already drives
 *   the band natively, so this is a vertical-only assist, not a general
 *   wheel-to-scroll remap.
 *
 * Otherwise the step is converted and always `preventDefault()`s, even right
 * at `scrollLeft`'s min/max edge: the band is a sibling of the map canvas in
 * the shell (`DirectoryMap.tsx`), not a descendant, so an unconsumed wheel
 * here never reaches the map's own zoom handler — the fall-through this
 * guards against is the default scroll chain (the band bubbling the gesture
 * to its scroll ancestors, ultimately the page), which would move the wrong
 * surface for a gesture the visitor aimed at the carousel. Direct
 * `scrollLeft` assignment, never `scrollTo({ behavior: "smooth" })`: wheel
 * steps arrive as a rapid-fire sequence and need to feel 1:1 with the
 * gesture, which also makes this inherently safe under reduced motion — an
 * instant per-step move is state catching up to input, not an animation.
 */
function useWheelHorizontalScroll(containerEl: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const container = containerEl.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (container.scrollWidth <= container.clientWidth) return;
      if (event.ctrlKey || event.metaKey) return;
      if (event.shiftKey) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      container.scrollLeft += normalizedWheelDelta(event, container.clientWidth);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [containerEl]);
}

/**
 * Bottom mini-card carousel, kept in sync with pin selection — identical in
 * both map paths. Each card leads its name row with the entry's index chip —
 * the same 1-based number as its pin, on the neutral `secondary` fill so the
 * safety colours stay unique to the pin and the chip row — purely a sighted
 * correlation aid: it is `aria-hidden`, the card's accessible name
 * (`cardAccessibleName`) never carries it, and safety meaning still comes
 * from the chip row below (colour + icon + label).
 * Text-dense slim cards carrying the browse card's anatomy minus the media
 * slot: name, the shared "city · distance" location line, the signals row, the
 * divider, and the meta row (activity line + happy-patron count). Same slots,
 * same order, same emptiness rules — only the widths differ.
 * The trust row follows the browse list card's rules (`ListingCard`): headline
 * `SafetySignal` (or the bot-provenance hint when there is no verdict but a
 * live bot suggestion, or nothing at all when neither), plus the incident
 * add-on chip whenever `hasRecentIncident` — recent harm must flag the
 * mini-card no matter the headline verdict.
 *
 * Selection scroll: a user selection (the shared `useUserSelectionChange`
 * discriminator) scrolls the selected card flush-left via
 * {@link scrollCardFlushLeft}; a "Load more" page the visitor requested here
 * scrolls its first new card the same way. A deep-link restore
 * (`restoreSelectedId`, the URL's `?sel=` at mount) scrolls its card
 * flush-left instantly — no animation, no focus move — as soon as the card
 * exists, which may be after URL-seeded extra pages land.
 *
 * Navigation: the chevron link is the accessible path to `/listings/$id` and
 * is always visible (muted until selected, brand-solid once selected). A tap
 * on the already-selected card navigates too — a sighted shortcut; AT users
 * get the same destination from the chevron's own "View {name}" link. Both
 * the chevron and the heart are sibling overlays of the card button, never
 * nested inside it (nested interactive controls are an a11y defect).
 *
 * Must sit above the pins with an opaque band so a low pin can never bleed
 * over a mini-card (safety-correctness — see the module comment). The opaque
 * `bg-background` band + top shadow, inside the z-10 positioning shell,
 * enforce it.
 */
export function MapCarousel({
  entries,
  selectedId,
  onSelect,
  loadMore,
  restoreSelectedId,
  resultSetPending = false,
}: {
  entries: readonly DirectoryMapEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When set, renders the "Load more" card after the last mini-card. */
  loadMore?: MapLoadMore;
  /**
   * The URL-restored selection (`?sel=`) to scroll to instantly once its card
   * exists. Read once at mount: later `sel` writes are user taps, which the
   * selection sync animates instead.
   */
  restoreSelectedId?: string | null;
  /**
   * True while the current entries may still be replaced without any
   * navigation for a reason `loadMore` cannot see (the route's distance
   * anchor is still resolving). The restore composes this with `loadMore`'s
   * own pending/failed state to decide when the set is settled.
   */
  resultSetPending?: boolean;
}) {
  const navigate = useNavigate();
  const containerEl = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  useWheelHorizontalScroll(containerEl);
  useUserSelectionChange(true, entries, selectedId, (id) => {
    const container = containerEl.current;
    const card = cardEls.current.get(id);
    if (!container || !card) return;
    scrollCardFlushLeft(container, card);
  });

  // The full "entries may still change without a navigation" signal: the
  // anchor half from the route, composed with the pages the hook itself is
  // still resolving. A failed page counts too — it is an unresolved hole in
  // the sequence the visitor can still retry, so offsets are as provisional
  // as during a load (mirrors the route's stale-sel strip gate).
  const entriesTransient =
    resultSetPending || (loadMore ? loadMore.pending || loadMore.failed : false);

  // Deep-link restore: put the restored selection's card flush-left the
  // moment it exists — instantly (a restored position is state, not motion),
  // before paint (useLayoutEffect: a cache-warm Back must never flash the
  // band at its start and then teleport), and without touching focus. While
  // the set is transient (`entriesTransient`) a hit snaps but stays armed:
  // a re-anchored or completed set may put the same card at a different
  // offset, and the settled set owns the final snap — skipped when its id
  // sequence matches the last provisional snap, so an unchanged set (e.g. a
  // denied geolocation prompt settling) never re-yanks the band. The target
  // dies when the visitor takes the band over (a card tap, a Load more
  // click, pointer or wheel input on the band) or when the selection lands
  // on a different card — the route's first-entry fallback after it strips
  // a stale `?sel=` arrives here that way — and always once a settled set
  // holding the target has been judged; a settled set missing it retires
  // via the route's strip-then-fallback.
  const restoreTarget = useRef(restoreSelectedId ?? null);
  const restoreSnappedIds = useRef<string | null>(null);
  useLayoutEffect(() => {
    const target = restoreTarget.current;
    if (!target) return;
    if (selectedId !== null && selectedId !== target) {
      restoreTarget.current = null;
      return;
    }
    if (!entries.some((entry) => entry.vm.id === target)) return;
    const container = containerEl.current;
    const card = cardEls.current.get(target);
    if (!container || !card) return;
    const sequence = entries.map((entry) => entry.vm.id).join("\n");
    if (entriesTransient) {
      if (restoreSnappedIds.current === sequence) return;
      restoreSnappedIds.current = sequence;
      scrollCardFlushLeft(container, card, "instant");
      return;
    }
    restoreTarget.current = null;
    if (restoreSnappedIds.current !== sequence) {
      scrollCardFlushLeft(container, card, "instant");
    }
  }, [entries, selectedId, entriesTransient]);

  // Reading by scrolling is a takeover too: pointer or wheel input on the
  // band retires the armed restore, so a later settle or page arrival can
  // never yank the band mid-read. Input events rather than scroll events on
  // purpose: the programmatic scrolls here (selection sync, append scroll,
  // the restore itself — instant reduced-motion variants included) fire
  // scroll events but never input events, so no programmatic-scroll flag is
  // needed and an interrupted smooth scroll cannot wedge the discriminator.
  // The scrollbar is hidden, so there is no scrollbar-drag path to miss.
  const onUserBandInput = () => {
    restoreTarget.current = null;
  };

  // Bring the first appended page into view: when new entries arrive as a
  // pure append (every previous id keeps its slot — a filter/sort/area
  // change replaces instead, and must not scroll) and the visitor asked for
  // it via the Load more card, the band scrolls to the first new card so
  // "Load more" visibly delivered something. Scroll only — focus never moves
  // to the new content. The click gate keeps a URL-seeded hydration append
  // (a restored `?pages=` arriving post-mount) from yanking the band.
  const appendRequested = useRef(false);
  const prevEntryIds = useRef<string[]>([]);
  useEffect(() => {
    const ids = entries.map((entry) => entry.vm.id);
    const prev = prevEntryIds.current;
    prevEntryIds.current = ids;
    if (prev.length === 0) return;
    const pureAppend = ids.length > prev.length && prev.every((id, i) => ids[i] === id);
    if (!pureAppend) {
      // A replacement or shrink retires the click: any in-flight Load more
      // now lands in a different set, so it no longer authorizes an append
      // scroll. An identical sequence (a content-only refresh) keeps it.
      const identical = ids.length === prev.length && prev.every((id, i) => ids[i] === id);
      if (!identical) appendRequested.current = false;
      return;
    }
    if (!appendRequested.current) return;
    appendRequested.current = false;
    const firstNewId = ids[prev.length];
    const container = containerEl.current;
    const firstNewCard = firstNewId ? cardEls.current.get(firstNewId) : undefined;
    if (!container || !firstNewCard) return;
    scrollCardFlushLeft(container, firstNewCard);
  }, [entries]);

  // A requested fetch that settles without growing the strip (every card was
  // a duplicate, or the page failed) must not leave the click armed for a
  // later append the visitor did not request. Runs after the append effect
  // above, so a delivering fetch gets its scroll in the same commit first.
  const appendPending = loadMore?.pending ?? false;
  const prevAppendPending = useRef(appendPending);
  useEffect(() => {
    if (prevAppendPending.current && !appendPending) {
      appendRequested.current = false;
    }
    prevAppendPending.current = appendPending;
  }, [appendPending]);

  // When the final page lands, the Load more card unmounts; if it held
  // focus, hand focus to the band (tabIndex -1 below) instead of letting it
  // drop to `<body>`. The focused flag rides a ref updated by focus/blur —
  // removing a focused element fires no blur, which is exactly the case this
  // catches.
  const loadMoreVisible = Boolean(
    loadMore && (loadMore.hasNext || loadMore.pending || loadMore.failed)
  );
  const loadMoreFocused = useRef(false);
  const prevLoadMoreVisible = useRef(loadMoreVisible);
  useEffect(() => {
    if (prevLoadMoreVisible.current && !loadMoreVisible && loadMoreFocused.current) {
      loadMoreFocused.current = false;
      containerEl.current?.focus();
    }
    prevLoadMoreVisible.current = loadMoreVisible;
  }, [loadMoreVisible]);

  return (
    // The band's positioning shell: it carries the `z-10` raise for the
    // carousel-above-pins safety invariant and hosts the edge-fade overlay,
    // which must be a sibling of the scroller — an absolutely positioned
    // child of a scroll container rides the scrolled content instead of
    // pinning to the band's visual edge.
    <div className="absolute inset-x-0 bottom-0 z-10">
      <div
        ref={containerEl}
        data-testid="map-carousel"
        // tabIndex -1: a programmatic focus target only (the Load more focus
        // hand-off above) — never a tab stop.
        tabIndex={-1}
        onPointerDown={onUserBandInput}
        onWheel={onUserBandInput}
        // The scroller owns the band's opaque fill and its `pt-3`/`pb-3`, so it
        // is the box {@link CAROUSEL_BAND_PX} measures; the shell adds none.
        // scroll-pr-10 = the fade's width: focus-driven minimal scrolls (a
        // tabbed-to heart/chevron) park the card clear of the fade instead of
        // flush under its most opaque zone, so focus rings stay unwashed. It is
        // a scroll padding, independent of the card width, so it needs no
        // retune when the mini-card resizes.
        className="flex gap-3 overflow-x-auto scroll-pr-10 bg-background px-4 pb-3 pt-3 shadow-[0_-8px_20px_rgba(76,50,120,0.1)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {entries.map(({ vm }, entryIndex) => {
          const selected = vm.id === selectedId;
          const index = entryIndex + 1;
          return (
            // Positioned wrapper so the heart is a sibling overlay of the mini-card
            // action — not nested inside it. Nesting a <button> (FavoriteButton)
            // inside the mini-card <button> would be invalid HTML + a
            // nested-interactive a11y defect. The wrapper carries the fixed
            // carousel-entry width; the mini-card button fills it, and FavoriteButton
            // is raised over it (`absolute … z-10`). The scroller's opaque
            // `bg-background` fill under the shell's `z-10` (documented above) still
            // keeps low pins behind the whole band, so nothing here weakens that
            // invariant.
            <div
              key={vm.id}
              ref={(node) => {
                if (node) cardEls.current.set(vm.id, node);
                else cardEls.current.delete(vm.id);
              }}
              // 224px: the mini-card carries the browse card's full meta row —
              // activity line and patron count — and a narrower box cannot hold
              // both without squeezing the name.
              className="relative w-[224px] shrink-0"
            >
              <button
                type="button"
                aria-pressed={selected}
                aria-label={cardAccessibleName(vm)}
                // First tap selects (pan/highlight); a tap on the already-selected
                // card opens the listing — a sighted shortcut only. The chevron
                // link below is the accessible navigation path, so AT never
                // depends on this press-again behaviour.
                onClick={() => {
                  if (selected) {
                    navigate({ to: "/listings/$id", params: { id: vm.id } });
                  } else {
                    // A tap is a takeover: a restore still waiting on its page
                    // is obsolete the moment the visitor picks a card.
                    restoreTarget.current = null;
                    onSelect(vm.id);
                  }
                }}
                // The selected card's thicker border is paid for out of its own
                // padding (`px-[11px] py-[7px]` vs `px-3 py-2`), so selecting a
                // card never changes its height — and never changes the band's
                // (see {@link CAROUSEL_BAND_PX}).
                className={`block w-full rounded-card bg-surface text-left shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring ${
                  selected
                    ? "border-2 border-brand px-[11px] py-[7px]"
                    : "border border-border px-3 py-2"
                }`}
              >
                {/* pr-14 keeps the two text rows clear of the overlaid heart
                  (right-3 + size-9 = 48px) with breathing room; the chip row
                  sits below the heart, full width. The leading index chip
                  shares the pin's number typography but sits on the neutral
                  `secondary` fill: correlation rides on the number alone, so
                  the solid safety colours stay unique to the pin and the
                  `SafetySignal` row keeps the loudest safety voice on the
                  card. */}
                <span className="flex items-center gap-1.5 pr-14">
                  <span
                    aria-hidden="true"
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground ${indexNumberClass(index)}`}
                  >
                    {index}
                  </span>
                  <span className="truncate font-display text-body-sm font-bold text-foreground">
                    {vm.name}
                  </span>
                </span>
                {/* The same location line the list card renders, from one shared
                  component so the two surfaces cannot disagree. At 224px only the
                  city truncates — the distance always stays whole. `pr-14` keeps
                  it clear of the overlaid heart. */}
                <CardLocationLine
                  vm={vm}
                  as="span"
                  className="mt-0.5 pr-14 text-caption text-muted-foreground"
                />
                {/* Trust row — the same rules as ListingCard's claim row.
                  `min-h-[30px]` reserves the badge family's rendered height
                  (py-1 + text-body-sm line + border) so every card keeps the
                  same height; overflow scrolls sideways like ListingCard's
                  row. `mr-10` ends the scroll box before the chevron overlay,
                  so a safety chip can never slide underneath it, and the
                  shared right-edge fade marks clipped content as scrollable
                  rather than truncated. Card-local, and unrelated to the
                  band's own edge fade below. */}
                <span
                  className={cn(
                    "mr-10 mt-1.5 flex min-h-[30px] items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                    SCROLL_FADE_RIGHT
                  )}
                >
                  {vm.safetyState ? (
                    <SafetySignal state={vm.safetyState} />
                  ) : vm.suggestedByBot ? (
                    // No verdict but a live bot suggestion: the shared provenance
                    // label, not a blank row. Provenance, never a verdict
                    // (ADR-007) — the card's accessible name carries the same
                    // context for AT.
                    <BotProvenanceLabel size="compact" data-testid="carousel-bot-provenance" />
                  ) : null}
                  {/* Recent harm flags the mini-card regardless of the headline
                    verdict (mirrors ListingCard) — an incident must never read
                    clean on the map. */}
                  {vm.hasRecentIncident ? <SafetySignal state="incident" /> : null}
                </span>
                {/* Meta row — the browse card's sixth slot in full: the activity
                  line on the left and the happy-patron count on the right, same
                  order, same meaning.

                  Plain text, not the tooltip trigger the browse card and the
                  detail hero use: a <button> inside this card's own <button>
                  would be invalid HTML and a nested-interactive a11y defect —
                  which is also why the label carries no dotted underline here,
                  since there is nothing to open. The clarifier reaches AT
                  through `cardAccessibleName` instead, which also folds in the
                  line itself and the patron phrase (`aria-label` hides button
                  content).

                  `pr-11`, not a margin: the divider is structure and must span
                  the full card width like the browse card's. The padding is what
                  clears the chevron overlay, whose inner edge sits 35px from this
                  padding box (`right-3` + `size-9` = 48px from the card's border
                  box, less the 1px border and the 12px `px-3`), leaving a 9px gap. */}
                <span
                  data-testid="carousel-activity"
                  className="mt-2 flex items-center justify-between gap-2 border-t border-border pr-11 pt-2 text-caption"
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-muted-foreground">
                    <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{vm.activity.updatedLabel}</span>
                  </span>
                  {/* Glyph + bare number at this width; the noun rides in the
                    shared component's visually-hidden text and in
                    `cardAccessibleName`. Absent at zero, as on the browse card. */}
                  <HappyPatrons meta={vm.activity} size="compact" />
                </span>
              </button>

              <FavoriteButton
                listingId={vm.id}
                listingName={vm.name}
                // The shared overlay chrome, raised to `top-2`: on a card this
                // short (see {@link CAROUSEL_BAND_PX} for the height breakdown)
                // the heart and the chevron below it would otherwise touch, so
                // the heart gives the pair its gap. Composed, never restated, so
                // the two surfaces cannot draw different hearts.
                className={cn(FAVORITE_OVERLAY_CHROME, "top-2")}
              />

              {/* Chevron link — the accessible way to open the listing, and a
                sibling overlay like the heart (never nested in the card
                button). Muted while unselected; selected uses the `primary`
                pair, whose dark-mode value is pinned for AA foreground
                contrast where the lightened dark `brand` is not (styling.md).
                Anchored at the card's bottom-right so it lands at the meta
                row's right end, past the patron count: the meta row's `pr-11`
                and the signals row's `mr-10` are what keep content clear of
                it, so it overlays only empty space. */}
              <Link
                to="/listings/$id"
                params={{ id: vm.id }}
                aria-label={`View ${vm.name}`}
                className={`absolute bottom-2 right-3 z-10 flex size-9 items-center justify-center rounded-full shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2 ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-background/80 text-muted-foreground backdrop-blur hover:text-brand"
                }`}
              >
                <ChevronRight className="size-4" strokeWidth={2.4} aria-hidden="true" />
              </Link>
            </div>
          );
        })}
        {/* "Load more" — an action card in the band (same height via the flex
          row's default stretch) that cannot be mistaken for a listing: dashed
          brand-tinted border, centred brand-toned action content. It stays
          while the just-requested final page is in flight (`pending`) and
          while a failed page offers its retry (`failed`), then unmounts once
          nothing more exists. Always before the end spacer: the spacer must
          stay the band's last child so the strip keeps its FAB clearance.
          Busy: `aria-busy` + `aria-disabled` + a click guard, never
          `disabled` — focus must stay on the control — with the spinner and
          label at full opacity. */}
        {loadMore && (loadMore.hasNext || loadMore.pending || loadMore.failed) ? (
          <button
            type="button"
            data-testid="carousel-load-more"
            aria-busy={loadMore.pending}
            aria-disabled={loadMore.pending}
            onFocus={() => {
              loadMoreFocused.current = true;
            }}
            onBlur={() => {
              loadMoreFocused.current = false;
            }}
            onClick={() => {
              if (loadMore.pending) return;
              // Marks the coming append as visitor-requested so the append
              // scroll above runs for it (and only for it). The click is also
              // a takeover of the band, so a still-armed provisional restore
              // must not snap back over the append.
              appendRequested.current = true;
              restoreTarget.current = null;
              loadMore.onLoadMore();
            }}
            className={`flex w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-brand/40 bg-surface px-3 py-2 text-body-sm font-semibold text-brand-strong hover:bg-brand-soft ${MAP_CONTROL_SURFACE}`}
          >
            {loadMore.pending ? (
              <LoaderCircle
                className="size-5 motion-safe:animate-spin"
                strokeWidth={2.25}
                aria-hidden="true"
              />
            ) : loadMore.failed ? (
              <RotateCw className="size-5" strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <Plus className="size-5" strokeWidth={2.25} aria-hidden="true" />
            )}
            {loadMore.pending ? "Loading…" : loadMore.failed ? "Try again" : "Load more"}
          </button>
        ) : null}
        {/* End spacer sized to the viewport-fixed Add-listing FAB's footprint
          (right offset + pill width), so the last card can always scroll fully
          clear of it instead of ending underneath. */}
        <div aria-hidden="true" data-testid="carousel-end-spacer" className="w-40 shrink-0" />
      </div>
      {/* Right-edge fade: the scrollbar is hidden, so a clipped card is the
          band's only scroll cue — this fade makes the clip read as scrollable
          (the trust row's right-edge mask idiom, at band scale). An overlay
          above the band, deliberately not a mask-image on the band itself: a
          mask would make the opaque `bg-background` translucent at the edge
          and let a low pin bleed through (the safety invariant above). z-10
          keeps it over the cards' own raised overlays (heart/chevron), and
          the scroller's scroll-pr-10 keeps a focus-driven scroll from parking
          those under it; pointer-events-none keeps the strip fully
          interactive beneath it. The viewport-fixed Add-listing FAB sits
          above at z-30, unfaded. No left-edge mirror: selection and restore
          park the chosen card flush-left, so a fade there would sit over its
          leading edge. */}
      <div
        aria-hidden="true"
        data-testid="carousel-edge-fade"
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-background to-transparent"
      />
    </div>
  );
}
