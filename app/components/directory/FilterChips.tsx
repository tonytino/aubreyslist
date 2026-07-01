import { Check, Funnel, Leaf, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import type { QuickFilter } from "~/components/directory/filtering";
import { TaxonomyFilter } from "~/components/listing/TaxonomyFilter";
import { Badge } from "~/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import type { ClaimAttribute } from "~/listings/taxonomy";

/**
 * Horizontal-scroll filter chip row (AUB-61, Phase 2b).
 *
 * Two kinds of chip, deliberately distinct in what they drive:
 *   - **Filters** opens the EXISTING {@link TaxonomyFilter} in a bottom Sheet.
 *     That is the real, URL-driven, SERVER-SIDE taxonomy filter (positive
 *     community consensus per attribute) — untouched by this redesign; the chip
 *     is purely a new entry point to it, and its badge surfaces the active count.
 *   - **Quick chips** (Celiac-safe / Gluten-friendly / Recently verified) are
 *     CLIENT-side filters over the already-loaded page and are MUTUALLY EXCLUSIVE
 *     (a single {@link QuickFilter} value), matching the bundle. They are real
 *     `<button>`s carrying `aria-pressed` so the toggle state is announced —
 *     never colour alone.
 *
 * The bundle's "Cuisine" chip is intentionally DROPPED (no cuisine data yet;
 * tracked in AUB-112).
 */

interface QuickChipDef {
  value: Exclude<QuickFilter, null>;
  label: string;
  Icon: LucideIcon;
}

const QUICK_CHIPS: readonly QuickChipDef[] = [
  { value: "celiac", label: "Celiac-safe", Icon: ShieldCheck },
  { value: "friendly", label: "Gluten-friendly", Icon: Leaf },
  { value: "recent", label: "Recently verified", Icon: Check },
];

/** Shared pill classes; `active` swaps to the filled brand treatment. */
function chipClasses(active: boolean): string {
  const base =
    "inline-flex shrink-0 items-center gap-1.5 rounded-chip border px-3 py-2 text-body-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring";
  return active
    ? `${base} border-brand bg-brand text-brand-foreground`
    : `${base} border-border bg-surface text-foreground hover:bg-brand-soft`;
}

export function FilterChips({
  attrs,
  onToggleAttr,
  onClearAttrs,
  quick,
  onQuickChange,
  sheetExtras,
}: {
  attrs: ClaimAttribute[];
  onToggleAttr: (attribute: ClaimAttribute) => void;
  onClearAttrs: () => void;
  quick: QuickFilter;
  onQuickChange: (next: QuickFilter) => void;
  /**
   * Extra controls rendered inside the Filters sheet, below the taxonomy filter —
   * the route passes the server-side sort control + pagination here so those
   * URL-driven controls stay reachable in the redesign (the bundle has no visible
   * sort/pager, but the server capability must not be lost).
   */
  sheetExtras?: React.ReactNode;
}) {
  return (
    <div className="-mx-gutter flex items-center gap-2 overflow-x-auto px-gutter pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Filters → the real server-side taxonomy filter, in a bottom sheet. */}
      <Sheet>
        <SheetTrigger asChild>
          <button type="button" className={chipClasses(false)}>
            <Funnel className="size-4" strokeWidth={2.25} aria-hidden="true" />
            <span>Filters</span>
            {attrs.length > 0 ? (
              <Badge variant="secondary" className="ml-0.5">
                {attrs.length}
              </Badge>
            ) : null}
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filter listings</SheetTitle>
            <SheetDescription>
              Narrow the list to places affirmed for the attributes you pick.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <TaxonomyFilter selected={attrs} onToggle={onToggleAttr} onClear={onClearAttrs} />
            {sheetExtras}
          </div>
        </SheetContent>
      </Sheet>

      {/* Mutually-exclusive quick chips (client-side, over the loaded page). */}
      {QUICK_CHIPS.map(({ value, label, Icon }) => {
        const active = quick === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => onQuickChange(active ? null : value)}
            className={chipClasses(active)}
          >
            <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
