import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, CircleDashed, LoaderCircle, LocateFixed, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { BotProvenanceLabel } from "~/components/listing/BotProvenanceLabel";
import { FavoriteButton } from "~/components/listing/FavoriteButton";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";
import {
  SafetySignal,
  type SafetyState,
  safetyIcon,
  safetyLabel,
  UnattestedBadge,
} from "~/components/SafetySignal";
import { prefersReducedMotion } from "~/lib/motion";

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
 * card.
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
 * The carousel's "Load more" wiring: appends the next server page to the map
 * view's accumulated entries. The card renders while a further page exists or
 * one is in flight, and hides for good once everything is loaded.
 */
export interface MapLoadMore {
  /** A further page exists after the loaded ones (from the honest total). */
  hasNext: boolean;
  /** The next page is being fetched. */
  pending: boolean;
  onLoadMore: () => void;
}

/**
 * Approximate rendered height of the opaque carousel band in px — the ONE
 * retune point when the mini-cards change size: `pt-3` (12) + card (~92: `py-2`
 * + name + address + 30px chip row + border) + `pb-3` (12). Derived from it:
 * the live map's `FIT_PADDING.bottom` and selection-pan offset
 * (`DirectoryMapLive.tsx`) and the recenter FAB's `bottom-[128px]` (band + a
 * 12px gap — Tailwind can't interpolate a JS constant into a class, so that
 * one is restated below).
 */
export const CAROUSEL_BAND_PX = 116;

/**
 * Invoke `onUserSelect` exactly when a selection change was caused by a user
 * tap on a pin/mini-card — the ONE discriminator shared by both selection-sync
 * surfaces (the carousel's scroll-into-view and the live map's pan), so their
 * notion of "user selection" can never drift. `selectedId` itself carries no
 * cause, so the cause is inferred from the transition; skipped by design:
 *
 * - the first selection seen while `ready` — mount, and the route's
 *   auto-select-first that lands right after (the selection effect in
 *   `app/routes/index.tsx` names this hook as a dependent);
 * - any change while `!ready` (the live map instance not created yet): nothing
 *   is recorded, so when `ready` flips the pending selection counts as
 *   initial, never replayed;
 * - a change whose PREVIOUS selection is no longer in `entries`: that is the
 *   route's validity guard reassigning after a filter change, not a tap — the
 *   camera/scroll must not chase it.
 */
export function useUserSelectionChange(
  ready: boolean,
  entries: readonly DirectoryMapEntry[],
  selectedId: string | null,
  onUserSelect: (id: string) => void
): void {
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const prev = prevSelected.current;
    prevSelected.current = selectedId;
    if (!selectedId || prev === null || prev === selectedId) return;
    if (!entries.some((entry) => entry.vm.id === prev)) return;
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
  "gluten-friendly": "bg-gluten-friendly text-gluten-friendly-foreground",
  stale: "bg-stale text-stale-foreground",
  incident: "bg-incident text-incident-foreground",
};

/**
 * The "Not yet attested" pin — neutral, still labelled, never a fake verdict.
 * `CircleDashed` (an "unknown" ring) is deliberately unshareable with any
 * verdict glyph: at dot size a shield outline reads celiac-safe under
 * greyscale/CVD, so this state must not borrow `ShieldCheck`. `text-background`
 * keeps the icon legible on the fill in BOTH themes: near-white on the mid-grey
 * light fill, near-black on the lightened `.dark` `muted-foreground` (where
 * white would drop to ~2.5:1).
 */
const UNATTESTED_PIN = {
  fill: "bg-muted-foreground text-background",
  Icon: CircleDashed,
  label: "Not yet attested",
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
 * The ONE accessible-name construction for both the pin and the mini-card
 * (`aria-label` overrides button content, so anything visual-only inside —
 * like the incident add-on chip — is invisible to AT unless folded in here).
 * A recent incident is appended whenever the headline state isn't already
 * "incident": what sighted users see (headline chip + red incident chip) is
 * exactly what screen readers hear.
 */
function pinAccessibleName(vm: RestaurantCardVM): string {
  const base = `${vm.name}, ${pinStyleFor(vm.safetyState).label}`;
  return vm.hasRecentIncident && vm.safetyState !== "incident"
    ? `${base}, ${safetyLabel("incident")}`
    : base;
}

/**
 * The mini-card's accessible name: the shared pin name plus, for a
 * bot-suggested listing with no verdict, the provenance the card's trust row
 * shows sighted users — the browse list card exposes the same context to AT.
 * Card-only on purpose: pin announcements stay terse.
 */
function cardAccessibleName(vm: RestaurantCardVM): string {
  const base = pinAccessibleName(vm);
  return !vm.safetyState && vm.suggestedByBot ? `${base}, suggested by Aubrey's Bot` : base;
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
        className={`flex size-6 items-center justify-center rounded-full border-2 border-white shadow-md motion-safe:transition-transform ${
          pin.fill
        }${selected ? " scale-125 ring-4 ring-brand/50" : ""}`}
      >
        {/* The correlation number (visual only — `aria-label` on the button
            already hides content from AT; aria-hidden makes that explicit). */}
        <span aria-hidden="true" className={indexNumberClass(index)}>
          {index}
        </span>
      </span>
    </button>
  );
}

/**
 * Recenter FAB. In the live map path `onClick` re-fits the camera to the
 * current pins; in the CSS-placeholder fallback it is passed no handler and
 * stays an unwired affordance. `bottom-[128px]` = {@link CAROUSEL_BAND_PX} +
 * a 12px gap, restated as a literal because Tailwind arbitrary values can't
 * interpolate a JS constant.
 */
export function RecenterFab({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label="Recenter map"
      {...(onClick ? { onClick } : {})}
      className="absolute bottom-[128px] right-4 z-[11] inline-flex size-11 items-center justify-center rounded-full border border-border bg-surface text-brand-strong shadow-md hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
    >
      <LocateFixed className="size-5" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}

/**
 * Bottom mini-card carousel, kept in sync with pin selection — identical in
 * both map paths. Each card leads its name row with the entry's index chip —
 * the same 1-based number as its pin, on the neutral `secondary` fill so the
 * safety colours stay unique to the pin and the chip row — purely a sighted
 * correlation aid: it is `aria-hidden`, the card's accessible name
 * (`cardAccessibleName`) never carries it, and safety meaning still comes
 * from the chip row below (colour + icon + label).
 * Text-dense slim cards: name, distance (address when no distance), and the
 * same trust row rules as the browse list card (`ListingCard`): headline
 * `SafetySignal` (or the bot-provenance hint when there is no verdict but a
 * live bot suggestion, or the shared dashed `UnattestedBadge` when neither),
 * plus the incident add-on chip whenever `hasRecentIncident` — recent harm
 * must flag the mini-card no matter the headline verdict.
 *
 * Selection scroll: on a user selection (the shared `useUserSelectionChange`
 * discriminator) the carousel element itself is scrolled via
 * `container.scrollTo` so the selected card lands flush with the left content
 * edge (the card's `offsetLeft` minus the band's own left padding). Never
 * `scrollIntoView`: that walks every scroll ancestor (so it can move the
 * page), and its options object is unreliable in mobile Safari — a direct
 * `scrollTo` on the one scroller is the only container this may ever move.
 * Smooth only when motion is allowed.
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
 * `bg-background` band + top shadow + z-10 enforce it.
 */
export function MapCarousel({
  entries,
  selectedId,
  onSelect,
  loadMore,
}: {
  entries: readonly DirectoryMapEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When set, renders the "Load more" card after the last mini-card. */
  loadMore?: MapLoadMore;
}) {
  const navigate = useNavigate();
  const containerEl = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  useUserSelectionChange(true, entries, selectedId, (id) => {
    const container = containerEl.current;
    const card = cardEls.current.get(id);
    if (!container || !card) return;
    // Flush-left target: the card's offset inside the carousel minus the
    // band's left padding, so the card's left edge lands on the visible
    // content edge, not under the padding. jsdom reports no computed padding;
    // `|| 0` keeps the fallback explicit.
    const paddingLeft = Number.parseFloat(getComputedStyle(container).paddingLeft) || 0;
    container.scrollTo({
      left: Math.max(0, card.offsetLeft - paddingLeft),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  });

  return (
    <div
      ref={containerEl}
      data-testid="map-carousel"
      className="absolute inset-x-0 bottom-0 z-10 flex gap-3 overflow-x-auto bg-background px-4 pb-3 pt-3 shadow-[0_-8px_20px_rgba(76,50,120,0.1)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
          // is raised over it (`absolute … z-10`). The carousel's own opaque
          // `bg-background` band + z-10 stacking (documented above) still keep low
          // pins behind the whole band, so nothing here weakens that invariant.
          <div
            key={vm.id}
            ref={(node) => {
              if (node) cardEls.current.set(vm.id, node);
              else cardEls.current.delete(vm.id);
            }}
            className="relative w-[200px] shrink-0"
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
                  onSelect(vm.id);
                }
              }}
              className={`block w-full rounded-card bg-surface px-3 py-2 text-left shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring ${
                selected ? "border-2 border-brand" : "border border-border"
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
              {/* Distance when the browse response derived one ("0.4 mi" — the
                  same server label the list card appends), address otherwise:
                  a standing-outside decision cue first, never an empty row. */}
              <span className="mt-0.5 block truncate pr-14 text-caption text-muted-foreground">
                {vm.distanceLabel ?? vm.address}
              </span>
              {/* Trust row — the same rules as ListingCard's claim row.
                  `min-h-[30px]` reserves the badge family's rendered height
                  (py-1 + text-body-sm line + border) so every card keeps the
                  same height; overflow scrolls sideways like ListingCard's
                  row. `mr-10` ends the scroll box before the chevron overlay,
                  so a safety chip can never slide underneath it, and the
                  right-edge mask fades clipped content so an overflowing
                  label reads as scrollable, not truncated. */}
              <span className="mr-10 mt-1.5 flex min-h-[30px] items-center gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%_-_16px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {vm.safetyState ? (
                  <SafetySignal state={vm.safetyState} />
                ) : vm.suggestedByBot ? (
                  // No verdict but a live bot suggestion: the shared provenance
                  // label, not the dashed empty-state chip and not a blank row.
                  // Provenance, never a verdict (ADR-007) — the card's
                  // accessible name carries the same context for AT.
                  <BotProvenanceLabel size="compact" data-testid="carousel-bot-provenance" />
                ) : (
                  <UnattestedBadge />
                )}
                {/* Recent harm flags the mini-card regardless of the headline
                    verdict (mirrors ListingCard) — an incident must never read
                    clean on the map. */}
                {vm.hasRecentIncident ? <SafetySignal state="incident" /> : null}
              </span>
            </button>

            <FavoriteButton
              listingId={vm.id}
              listingName={vm.name}
              // The default overlay chrome with `top-2` instead of `top-3`:
              // on the ~92px mini-card the heart and the chevron below it
              // would otherwise touch, so the heart gives the pair its gap.
              className="absolute right-3 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-colors hover:text-brand"
            />

            {/* Chevron link — the accessible way to open the listing, and a
                sibling overlay like the heart (never nested in the card
                button). Muted while unselected; selected uses the `primary`
                pair, whose dark-mode value is pinned for AA foreground
                contrast where the lightened dark `brand` is not (styling.md).
                Sits under the heart in the card's right rail; the trust row's
                `mr-10` keeps chips clear of it. */}
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
      {/* "Load more" — an action card in the card family (same band height via
          the flex row's default stretch; surface + border like a mini-card, but
          centred brand-toned action content so it cannot be mistaken for a
          listing). It stays visible while the just-requested final page is
          still in flight (`pending`), then unmounts once nothing more exists.
          Always before the end spacer: the spacer must stay the band's last
          child so the strip keeps its FAB clearance. */}
      {loadMore && (loadMore.hasNext || loadMore.pending) ? (
        <button
          type="button"
          data-testid="carousel-load-more"
          disabled={loadMore.pending}
          onClick={loadMore.onLoadMore}
          className="flex w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-card border border-border bg-surface px-3 py-2 text-body-sm font-semibold text-brand-strong shadow-md motion-safe:transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring disabled:opacity-70"
        >
          {loadMore.pending ? (
            <LoaderCircle
              className="size-5 motion-safe:animate-spin"
              strokeWidth={2.25}
              aria-hidden="true"
            />
          ) : (
            <Plus className="size-5" strokeWidth={2.25} aria-hidden="true" />
          )}
          {loadMore.pending ? "Loading…" : "Load more"}
        </button>
      ) : null}
      {/* End spacer sized to the viewport-fixed Add-listing FAB's footprint
          (right offset + pill width), so the last card can always scroll fully
          clear of it instead of ending underneath. */}
      <div aria-hidden="true" data-testid="carousel-end-spacer" className="w-40 shrink-0" />
    </div>
  );
}
