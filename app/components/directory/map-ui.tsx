import type { LucideIcon } from "lucide-react";
import { Clock, LocateFixed, ShieldCheck, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { WheatStrike } from "~/components/icons/WheatStrike";
import { FavoriteButton } from "~/components/listing/FavoriteButton";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";
import { type SafetyState, safetyLabel } from "~/components/SafetySignal";

/**
 * Shared presentational pieces of the directory Map view (AUB-61 → AUB-111):
 * the safety-pin styling, the pin button, the bottom mini-card carousel, and
 * the recenter FAB. BOTH map paths render these — the real Google map
 * (`DirectoryMapLive.tsx`, key present) and the stylized CSS-placeholder
 * fallback (`DirectoryMap.tsx`, key absent) — so the safety-signal visuals and
 * accessible names can never drift between them.
 *
 * SAFETY-CORRECTNESS (from the bundle, NON-NEGOTIABLE): a pin carries a safety
 * signal (colour + icon + label), so a pin must NEVER visually float over a
 * DIFFERENT restaurant's card — a mis-associated safety signal is a real harm
 * (e.g. a red incident pin bleeding onto a celiac-safe card). We enforce this
 * two ways: the carousel sits at `z-10` ABOVE the pins (`z-1`/`z-6` in the
 * placeholder; the Google map canvas is an unpositioned/z-0 sibling in the
 * live path) AND draws an OPAQUE background band, so any low pin hides BEHIND
 * the band instead of over a card.
 *
 * ACCESSIBILITY: every pin and mini-card is a real `<button>`; the pin's icon
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

/** Pin fill + icon per safety meaning (mirrors SafetySignal's state config). */
const PIN_STYLES: Record<
  SafetyState,
  { fill: string; ring: string; Icon: LucideIcon; label: string }
> = {
  "celiac-safe": {
    fill: "bg-celiac-safe",
    ring: "ring-celiac-safe/30",
    Icon: ShieldCheck,
    label: safetyLabel("celiac-safe"),
  },
  "gluten-friendly": {
    fill: "bg-gluten-friendly",
    ring: "ring-gluten-friendly/30",
    // The branded "gluten struck out" glyph — the SAME icon SafetySignal renders
    // for this state (AUB-133), so the pin's shape matches every other surface.
    Icon: WheatStrike,
    label: safetyLabel("gluten-friendly"),
  },
  stale: {
    fill: "bg-stale",
    ring: "ring-stale/30",
    Icon: Clock,
    label: safetyLabel("stale"),
  },
  incident: {
    fill: "bg-incident",
    ring: "ring-incident/30",
    Icon: TriangleAlert,
    label: safetyLabel("incident"),
  },
};

/** The "Not yet attested" pin — neutral, still labelled, never a fake verdict. */
const UNATTESTED_PIN = {
  fill: "bg-muted-foreground",
  ring: "ring-muted-foreground/30",
  Icon: ShieldCheck,
  label: "Not yet attested",
} as const;

export function pinStyleFor(state: SafetyState | null) {
  return state ? PIN_STYLES[state] : UNATTESTED_PIN;
}

/**
 * The safety pin itself — an accessible `<button>` whose name carries the
 * restaurant + its safety state (never colour alone). Positioning is the
 * CALLER's job: the placeholder projects it with `absolute` + `left`/`top`
 * percentages; the live map wraps it in an `<AdvancedMarker>` anchored at the
 * true lat/lng (there the marker carries the z-order, so no extra classes).
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
      className={`flex size-9 items-center justify-center rounded-[999px_999px_999px_3px] border-[2.5px] border-surface text-white shadow-md transition-transform ${
        pin.fill
      }${selected ? " scale-110 ring-4 ring-brand/30 motion-safe:scale-125" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      <PinIcon className="size-4" strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}

/**
 * Recenter FAB. In the live map path `onClick` re-fits the camera to the
 * current pins; in the CSS-placeholder fallback it is passed no handler and
 * stays exactly the unwired affordance it was before AUB-111.
 */
export function RecenterFab({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label="Recenter map"
      {...(onClick ? { onClick } : {})}
      className="absolute bottom-[158px] right-4 z-[11] inline-flex size-11 items-center justify-center rounded-full border border-border bg-surface text-brand-strong shadow-md hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
    >
      <LocateFixed className="size-5" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}

/**
 * Bottom mini-card carousel, kept in sync with pin selection — identical in
 * both map paths.
 *
 * MUST sit above the pins with an OPAQUE band so a low pin can never bleed
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
  return (
    <div
      data-testid="map-carousel"
      className="absolute inset-x-0 bottom-0 z-10 flex gap-3 overflow-x-auto bg-background px-4 pb-[18px] pt-6 shadow-[0_-8px_20px_rgba(76,50,120,0.1)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {entries.map(({ vm }) => {
        const style = pinStyleFor(vm.safetyState);
        const selected = vm.id === selectedId;
        const ChipIcon = style.Icon;
        return (
          // Positioned wrapper so the heart is a SIBLING overlay of the mini-card
          // action (F6, AUB-125) — NOT nested inside it. Nesting a <button>
          // (FavoriteButton) inside the mini-card <button> would be invalid HTML +
          // nested-interactive a11y defect. The wrapper carries the fixed
          // carousel-entry width; the mini-card button fills it, and FavoriteButton
          // is raised over it (`absolute … z-10`). The carousel's own opaque
          // `bg-background` band + z-10 stacking (documented above) still keep low
          // pins behind the whole band, so nothing here weakens that invariant.
          <div key={vm.id} className="relative w-[236px] shrink-0">
            <button
              type="button"
              aria-pressed={selected}
              aria-label={`${vm.name}, ${style.label}`}
              onClick={() => onSelect(vm.id)}
              className={`flex w-full overflow-hidden rounded-card border bg-surface text-left shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring ${
                selected ? "border-2 border-brand" : "border border-border"
              }`}
            >
              <span
                aria-hidden="true"
                className={`w-[78px] shrink-0 ${
                  vm.accent === "peach"
                    ? "bg-accent-peach"
                    : vm.accent === "mint"
                      ? "bg-accent-mint"
                      : vm.accent === "sky"
                        ? "bg-accent-sky"
                        : "bg-accent-lavender"
                }`}
              />
              <span className="min-w-0 flex-1 px-3 py-2.5 pr-12">
                <span className="block truncate font-display text-body-sm font-bold text-foreground">
                  {vm.name}
                </span>
                <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                  {vm.address}
                  {vm.distanceLabel ? ` · ${vm.distanceLabel}` : ""}
                </span>
                <span
                  className={`mt-2 inline-flex items-center gap-1.5 rounded-chip px-2.5 py-1 text-caption font-semibold text-white ${style.fill}`}
                >
                  <ChipIcon className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                  <span>{style.label}</span>
                </span>
              </span>
            </button>

            <FavoriteButton listingId={vm.id} listingName={vm.name} />
          </div>
        );
      })}
    </div>
  );
}
