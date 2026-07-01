import { Clock, Leaf, LocateFixed, ShieldCheck, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type SafetyState, safetyLabel } from "~/components/SafetySignal";
import { projectToMap } from "~/components/directory/map-projection";
import type { RestaurantCardVM } from "~/components/listing/ListingCard";

/**
 * The Map view (AUB-61, Phase 2b) — a STYLIZED placeholder. The real map provider
 * (Mapbox / Google) is deferred to AUB-111; DO NOT add a map SDK here. This is a
 * CSS backdrop (grid + park/water blobs) with pins projected from each listing's
 * REAL `lat`/`lng` via a fixed metro-Denver bounding box (`projectToMap`), plus a
 * bottom carousel of mini cards kept in sync with pin selection.
 *
 * SAFETY-CORRECTNESS (from the bundle, NON-NEGOTIABLE): a pin carries a safety
 * signal (colour + icon + label), so a pin must NEVER visually float over a
 * DIFFERENT restaurant's card — a mis-associated safety signal is a real harm
 * (e.g. a red incident pin bleeding onto a celiac-safe card). We enforce this two
 * ways: the carousel sits at `z-10` ABOVE the pins (`z-1`/`z-6`) AND draws an
 * OPAQUE background band, so any low pin hides BEHIND the band instead of over a
 * card.
 *
 * ACCESSIBILITY: every pin and mini-card is a real `<button>`; the pin's icon is
 * decorative and its accessible name is the restaurant name + its safety state,
 * so the safety meaning is never colour-only. The selected pin/mini-card carry
 * `aria-pressed` in addition to the visual ring/border.
 */

/** One map entry: the presentational VM plus the real coordinates to project. */
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
    Icon: Leaf,
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

function pinStyleFor(state: SafetyState | null) {
  return state ? PIN_STYLES[state] : UNATTESTED_PIN;
}

export function DirectoryMap({
  entries,
  selectedId,
  onSelect,
}: {
  entries: readonly DirectoryMapEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Stylized backdrop: two soft blobs (park/water) + a faint grid. Decorative
          only — replaced by a real map in AUB-111. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_72%_24%,var(--color-accent-mint)_0_62px,transparent_63px),radial-gradient(circle_at_16%_78%,var(--color-accent-sky)_0_74px,transparent_75px),repeating-linear-gradient(0deg,var(--color-border)_0_1.5px,transparent_1.5px_48px),repeating-linear-gradient(90deg,var(--color-border)_0_1.5px,transparent_1.5px_48px)] bg-background"
      />

      {/* Pins — projected from real lat/lng. Each is an accessible button whose
          name carries the restaurant + its safety state (never colour alone). */}
      <ul className="absolute inset-0 list-none">
        {entries.map(({ vm, lat, lng }) => {
          const { left, top } = projectToMap(lat, lng);
          const style = pinStyleFor(vm.safetyState);
          const selected = vm.id === selectedId;
          const PinIcon = style.Icon;
          return (
            <li key={vm.id}>
              <button
                type="button"
                aria-pressed={selected}
                aria-label={`${vm.name} — ${style.label}`}
                onClick={() => onSelect(vm.id)}
                // Runtime-computed left/top from the projection — the sanctioned
                // inline-style exception (dynamic positioning).
                style={{ left: `${left}%`, top: `${top}%` }}
                className={`absolute flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[999px_999px_999px_3px] border-[2.5px] border-surface text-white shadow-md transition-transform ${
                  style.fill
                } ${
                  selected ? "z-[6] scale-110 ring-4 ring-brand/30 motion-safe:scale-125" : "z-[1]"
                }`}
              >
                <PinIcon className="size-4" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      {/* Recenter FAB — present but unwired (real recentre lands with AUB-111). */}
      <button
        type="button"
        aria-label="Recenter map"
        className="absolute bottom-[158px] right-4 z-[11] inline-flex size-11 items-center justify-center rounded-full border border-border bg-surface text-brand-strong shadow-md hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      >
        <LocateFixed className="size-5" strokeWidth={2.25} aria-hidden="true" />
      </button>

      {/* Bottom carousel — MUST sit above the pins with an OPAQUE band so a low
          pin can never bleed over a mini-card (safety-correctness). The opaque
          `bg-background` band + top shadow + z-10 enforce it. */}
      <div
        data-testid="map-carousel"
        className="absolute inset-x-0 bottom-0 z-10 flex gap-3 overflow-x-auto bg-background px-4 pb-[18px] pt-6 shadow-[0_-8px_20px_rgba(76,50,120,0.1)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {entries.map(({ vm }) => {
          const style = pinStyleFor(vm.safetyState);
          const selected = vm.id === selectedId;
          const ChipIcon = style.Icon;
          return (
            <button
              key={vm.id}
              type="button"
              aria-pressed={selected}
              aria-label={`${vm.name} — ${style.label}`}
              onClick={() => onSelect(vm.id)}
              className={`flex w-[236px] shrink-0 overflow-hidden rounded-card border bg-surface text-left shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring ${
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
              <span className="min-w-0 flex-1 px-3 py-2.5">
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
          );
        })}
      </div>
    </div>
  );
}
