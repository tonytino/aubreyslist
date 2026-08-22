import { CircleDashed, LocateFixed } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
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
 * Accessibility: every pin and mini-card is a real `<button>`; the pin's icon
 * is decorative and its accessible name is the restaurant name + its safety
 * state — with a recent incident folded in (`pinAccessibleName`), since
 * `aria-label` hides button content from AT — so the safety meaning is never
 * colour-only and never sighted-only. The selected pin/mini-card carry
 * `aria-pressed` in addition to the visual ring/border.
 */

/** One map entry: the presentational VM plus the real coordinates to place. */
export interface DirectoryMapEntry {
  vm: RestaurantCardVM;
  lat: number;
  lng: number;
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
  return { fill: PIN_FILLS[state], Icon: safetyIcon(state), label: safetyLabel(state) };
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
 * The safety pin itself — an accessible `<button>` whose name carries the
 * restaurant + its safety state (never colour alone). The visible pin is a
 * 24px micro-dot (colour fill + distinct icon shape), centred inside a 44px
 * transparent button so the tap target stays finger-sized (WCAG 2.5.5 / the
 * same `size-11` the recenter FAB uses) while the map reads uncluttered.
 *
 * Selected treatment (AUB-277 pill variant): the dot expands sideways into a
 * pill — same fill/halo, icon + the truncated restaurant name (`max-w-[160px]`)
 * — with the brand ring as the selected affordance. The pill stays 24px tall
 * (h-6, ≤ the previous scale-125 footprint) and grows only horizontally from
 * the same centre, so the coordinate anchor stays honest and the carousel-band
 * clearance math (`CAROUSEL_BAND_PX`/FIT_PADDING) is untouched. Pill CONTENT is
 * state, not motion: the name is present unconditionally when selected and only
 * the expansion transition is motion-gated, so reduced-motion users get the
 * pill instantly. The name text is `aria-hidden` — it duplicates the button's
 * accessible name (`pinAccessibleName`), which would otherwise announce twice.
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
  selected,
  onSelect,
  className,
  style,
}: {
  vm: RestaurantCardVM;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Positioning/stacking utilities appended by the caller (may be empty). */
  className?: string;
  /** Runtime-computed positioning (the placeholder's projected left/top). */
  style?: CSSProperties;
}) {
  const pin = pinStyleFor(vm.safetyState);
  const PinIcon = pin.Icon;
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
      {/* The visual micro-dot / selected pill. `min-w-6` keeps the unselected
          dot exactly 24px (the zero-width name span adds nothing); selecting
          adds padding + the name, so the pill grows sideways from the same
          centre. Only the transitions are motion-gated — the expanded state
          itself is unconditional. */}
      <span
        className={`flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white shadow-md motion-safe:transition-[padding] ${
          pin.fill
        }${selected ? " px-1 ring-4 ring-brand/50" : ""}`}
      >
        <PinIcon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        {/* aria-hidden: duplicates the button's accessible name — announcing it
            as content too would double-speak (aria-label wins anyway). */}
        <span
          aria-hidden="true"
          className={`truncate text-caption font-semibold motion-safe:transition-[max-width,opacity] ${
            selected ? "max-w-[160px] pl-1 opacity-100" : "max-w-0 opacity-0"
          }`}
        >
          {vm.name}
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
 * both map paths. Text-dense slim cards: name, address · distance, and the
 * same trust row rules as the browse list card (`ListingCard`): headline
 * `SafetySignal` (or the shared dashed `UnattestedBadge` when there is no
 * verdict and nothing bot-suggested), plus the incident add-on chip whenever
 * `hasRecentIncident` — recent harm must flag the mini-card no matter the
 * headline verdict. On a user selection (the shared
 * `useUserSelectionChange` discriminator), the selected card scrolls into
 * view — `inline: "center"`, `block: "nearest"` so the page itself never
 * jumps, smooth only when motion is allowed.
 *
 * Must sit above the pins with an opaque band so a low pin can never bleed
 * over a mini-card (safety-correctness — see the module comment). The opaque
 * `bg-background` band + top shadow + z-10 enforce it.
 */
export function MapCarousel({
  entries,
  selectedId,
  onSelect,
}: {
  entries: readonly DirectoryMapEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  useUserSelectionChange(true, entries, selectedId, (id) => {
    cardEls.current.get(id)?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  });

  return (
    <div
      data-testid="map-carousel"
      className="absolute inset-x-0 bottom-0 z-10 flex gap-3 overflow-x-auto bg-background px-4 pb-3 pt-3 shadow-[0_-8px_20px_rgba(76,50,120,0.1)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {entries.map(({ vm }) => {
        const selected = vm.id === selectedId;
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
              aria-label={pinAccessibleName(vm)}
              onClick={() => onSelect(vm.id)}
              className={`block w-full rounded-card bg-surface px-3 py-2 text-left shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring ${
                selected ? "border-2 border-brand" : "border border-border"
              }`}
            >
              {/* pr-14 keeps the two text rows clear of the overlaid heart
                  (right-3 + size-9 = 48px) with breathing room; the chip row
                  sits below the heart, full width. */}
              <span className="block truncate pr-14 font-display text-body-sm font-bold text-foreground">
                {vm.name}
              </span>
              <span className="mt-0.5 block truncate pr-14 text-caption text-muted-foreground">
                {vm.address}
                {vm.distanceLabel ? ` · ${vm.distanceLabel}` : ""}
              </span>
              {/* Trust row — the same rules as ListingCard's claim row.
                  `min-h-[30px]` reserves the badge family's rendered height
                  (py-1 + text-body-sm line + border) so the one chip-less case
                  (bot-suggested, no verdict) keeps every card the same height;
                  overflow scrolls sideways like ListingCard's row. */}
              <span className="mt-1.5 flex min-h-[30px] items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {vm.safetyState ? (
                  <SafetySignal state={vm.safetyState} />
                ) : vm.suggestedByBot ? null : (
                  <UnattestedBadge />
                )}
                {/* Recent harm flags the mini-card regardless of the headline
                    verdict (mirrors ListingCard) — an incident must never read
                    clean on the map. */}
                {vm.hasRecentIncident ? <SafetySignal state="incident" /> : null}
              </span>
            </button>

            <FavoriteButton listingId={vm.id} listingName={vm.name} />
          </div>
        );
      })}
    </div>
  );
}
