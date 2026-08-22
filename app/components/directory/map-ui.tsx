import { LocateFixed, ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { FavoriteButton } from "~/components/listing/FavoriteButton";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";
import { SafetySignal, type SafetyState, safetyIcon, safetyLabel } from "~/components/SafetySignal";
import { Badge } from "~/components/ui/badge";

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
 * state, so the safety meaning is never colour-only. The selected pin/mini-card
 * carry `aria-pressed` in addition to the visual ring/border.
 */

/** One map entry: the presentational VM plus the real coordinates to place. */
export interface DirectoryMapEntry {
  vm: RestaurantCardVM;
  lat: number;
  lng: number;
}

/**
 * `true` when the visitor asks for reduced motion (client-only; SSR → false).
 * Shared by every map-view motion gate: the live camera fits/pans
 * (`DirectoryMapLive.tsx`) and the carousel's scroll-into-view below.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Pin-local solid fills per safety state. Only the fill lives here — the icon
 * and label come from `SafetySignal`'s state config (`safetyIcon` /
 * `safetyLabel`), the one source of the state → shape + wording mapping.
 */
const PIN_FILLS: Record<SafetyState, string> = {
  "celiac-safe": "bg-celiac-safe",
  "gluten-friendly": "bg-gluten-friendly",
  stale: "bg-stale",
  incident: "bg-incident",
};

/** The "Not yet attested" pin — neutral, still labelled, never a fake verdict. */
const UNATTESTED_PIN = {
  fill: "bg-muted-foreground",
  Icon: ShieldCheck,
  label: "Not yet attested",
} as const;

export function pinStyleFor(state: SafetyState | null) {
  if (!state) return UNATTESTED_PIN;
  return { fill: PIN_FILLS[state], Icon: safetyIcon(state), label: safetyLabel(state) };
}

/**
 * The safety pin itself — an accessible `<button>` whose name carries the
 * restaurant + its safety state (never colour alone). The visible pin is a
 * 24px micro-dot (colour fill + distinct icon shape), centred inside a 44px
 * transparent button so the tap target stays finger-sized (WCAG 2.5.5 / the
 * same `size-11` the recenter FAB uses) while the map reads uncluttered.
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
      aria-label={`${vm.name}, ${pin.label}`}
      onClick={() => onSelect(vm.id)}
      // Runtime-computed left/top from the projection — the sanctioned
      // inline-style exception (dynamic positioning). Undefined on the live map.
      {...(style ? { style } : {})}
      className={`flex size-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring${
        className ? ` ${className}` : ""
      }`}
    >
      {/* The visual micro-dot. Selection grows it (animated only under
          motion-safe) and adds the brand ring; the surrounding hit area never
          changes size. */}
      <span
        className={`flex size-6 items-center justify-center rounded-full border-2 border-surface text-white shadow-md motion-safe:transition-transform ${
          pin.fill
        }${selected ? " scale-110 ring-4 ring-brand/30 motion-safe:scale-125" : ""}`}
      >
        <PinIcon className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
      </span>
    </button>
  );
}

/**
 * Recenter FAB. In the live map path `onClick` re-fits the camera to the
 * current pins; in the CSS-placeholder fallback it is passed no handler and
 * stays an unwired affordance. `bottom-[128px]` seats it just above the
 * ~116px carousel band below — retune both together.
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
 * safety chip (the shared `SafetySignal`, so the chip is the same one the
 * list view renders). When the selection changes (a pin tap), the selected
 * card scrolls into view — `inline: "center"`, `block: "nearest"` so the page
 * itself never jumps, smooth only under motion-safe, and skipped for the
 * initial auto-select so mount never animates.
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
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSelected.current;
    prevSelected.current = selectedId;
    // Skip the first selection (mount, or the route's auto-select-first
    // arriving right after mount): only a *change* from one entry to another
    // — a real pin tap — scrolls, so initial render never animates.
    if (!selectedId || prev === null || prev === selectedId) return;
    cardEls.current.get(selectedId)?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [selectedId]);

  return (
    <div
      data-testid="map-carousel"
      className="absolute inset-x-0 bottom-0 z-10 flex gap-3 overflow-x-auto bg-background px-4 pb-3 pt-3 shadow-[0_-8px_20px_rgba(76,50,120,0.1)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {entries.map(({ vm }) => {
        const pin = pinStyleFor(vm.safetyState);
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
              aria-label={`${vm.name}, ${pin.label}`}
              onClick={() => onSelect(vm.id)}
              className={`block w-full rounded-card bg-surface px-3 py-2 text-left shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring ${
                selected ? "border-2 border-brand" : "border border-border"
              }`}
            >
              {/* pr-12 keeps the two text rows clear of the overlaid heart
                  (right-3 + size-9); the chip row sits below it, full width. */}
              <span className="block truncate pr-12 font-display text-body-sm font-bold text-foreground">
                {vm.name}
              </span>
              <span className="mt-0.5 block truncate pr-12 text-caption text-muted-foreground">
                {vm.address}
                {vm.distanceLabel ? ` · ${vm.distanceLabel}` : ""}
              </span>
              <span className="mt-1.5 block">
                {vm.safetyState ? (
                  <SafetySignal state={vm.safetyState} />
                ) : (
                  // The same honest dashed empty-state chip the browse list
                  // card renders for a null verdict (ListingCard.tsx).
                  <Badge
                    variant="outline"
                    className="border-dashed px-2.5 py-1 text-body-sm font-medium text-muted-foreground"
                  >
                    Not yet attested
                  </Badge>
                )}
              </span>
            </button>

            <FavoriteButton listingId={vm.id} listingName={vm.name} />
          </div>
        );
      })}
    </div>
  );
}
