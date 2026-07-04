import { useSuspenseQuery } from "@tanstack/react-query";
import { Check, Funnel, Heart, RotateCcw, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { currentUserQuery } from "~/auth/current-user-query";
import { SearchChip } from "~/components/directory/SearchChip";
import { WheatStrike } from "~/components/icons/WheatStrike";
import { TaxonomyFilter } from "~/components/listing/TaxonomyFilter";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import type { QuickFilterValue } from "~/listings/quick";
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
 *     URL-driven, SERVER-side filters (`?quick=`, AUB-135/AUB-140) forming a faceted
 *     SET: the `safety` pair (celiac / friendly) is mutually exclusive, while
 *     `recent` toggles additively. Exclusivity is enforced by the parent's
 *     `applyQuickToggle` reducer — this component just renders whatever set it's
 *     handed and reports each click via `onQuickToggle`. They are real `<button>`s
 *     carrying `aria-pressed` so the toggle state is announced — never colour alone.
 *
 * SEARCH-AS-CHIP (user feedback #5): the free-text search now leads the row as a
 * {@link SearchChip} (replacing the old standalone search field above the chips).
 * It shares the chip visual language and is controlled by the route's
 * `search`/`onSearchChange` (still mirrored to the URL `?q=` with a debounce there),
 * so it reads as "just another filter" while staying SERVER-complete.
 *
 * The bundle's "Cuisine" chip is intentionally DROPPED (no cuisine data yet;
 * tracked in AUB-112).
 */

interface QuickChipDef {
  value: QuickFilterValue;
  label: string;
  Icon: LucideIcon;
}

const QUICK_CHIPS: readonly QuickChipDef[] = [
  { value: "celiac", label: "Celiac-safe", Icon: ShieldCheck },
  // Brand "gluten struck out" glyph — matches SafetySignal's `gluten-friendly`
  // icon (AUB-133) so the same state reads with the same shape everywhere,
  // rather than lucide's generic `Leaf`. Drop-in compatible: typed as
  // `LucideIcon`, same 24×24 box, sized/stroked identically to the other chips.
  { value: "friendly", label: "Gluten-friendly", Icon: WheatStrike },
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

/**
 * Build the relative post-sign-in `returnTo` for an anonymous "Saved" click: the
 * CURRENT path with `?saved=1` set, so the OAuth callback lands the diner back on
 * the directory already switched into their saved view. A RELATIVE path only
 * (the server's `validateReturnTo` rejects anything else); SSR-safe via the
 * `typeof window` guard (the chip hydrates before any anonymous click).
 */
function buildSavedReturnTo(): string {
  if (typeof window === "undefined") {
    return "/?saved=1";
  }
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  params.set("saved", "1");
  return `${pathname}?${params.toString()}`;
}

/**
 * The sign-in-gated "Saved" chip (AUB-129 / F11). Signed-in → toggles the
 * server-side `?saved=1` mode via `onToggle`. Anonymous → opens the SAME kind of
 * Radix sign-in dialog as {@link FavoriteButton} (no toggle, no server call), so
 * an anonymous viewer can never trigger a `savedOnly` request.
 *
 * Signed-in state comes from the root-prefetched {@link currentUserQuery} via
 * `useSuspenseQuery` (the repo convention), so it renders correctly on first
 * paint. CLIENT-SAFE: imports only `currentUserQuery` + `ui/dialog`, never
 * `~/server/*`/`~/db`.
 */
function SavedChip({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  const { data: currentUser } = useSuspenseQuery(currentUserQuery);
  const [signInOpen, setSignInOpen] = useState(false);

  const isSignedIn = currentUser != null;
  // The saved MODE is only active for a signed-in viewer; an anonymous viewer is
  // never "pressed" (colour is never the sole cue — `aria-pressed` announces it).
  const active = isSignedIn && saved;

  const handleClick = () => {
    if (!isSignedIn) {
      // Anonymous: NO navigation — explain saved spots and offer sign-in.
      setSignInOpen(true);
      return;
    }
    onToggle();
  };

  const signInHref = `/api/auth/google?returnTo=${encodeURIComponent(buildSavedReturnTo())}`;

  return (
    <>
      <button
        type="button"
        aria-pressed={active}
        onClick={handleClick}
        className={chipClasses(active)}
      >
        <Heart
          className={`size-4 ${active ? "fill-current" : ""}`}
          strokeWidth={2.25}
          aria-hidden="true"
        />
        <span>Saved</span>
      </button>

      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign in to see your saved spots</DialogTitle>
            <DialogDescription>
              Sign in to save spots you trust and filter the directory to just those places.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild>
              <a href={signInHref}>Sign in</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FilterChips({
  attrs,
  onToggleAttr,
  onClearAttrs,
  quick,
  onQuickToggle,
  search,
  onSearchChange,
  saved,
  onSavedToggle,
  sheetExtras,
  isAnyFilterActive,
  onResetAll,
}: {
  attrs: ClaimAttribute[];
  onToggleAttr: (attribute: ClaimAttribute) => void;
  onClearAttrs: () => void;
  /** The active quick-filter set (URL-derived). A chip is pressed iff it's a member. */
  quick: QuickFilterValue[];
  /** Report a chip click; the parent's `applyQuickToggle` computes the next set. */
  onQuickToggle: (value: QuickFilterValue) => void;
  /** Current free-text search value (the route mirrors it to `?q=`, debounced). */
  search: string;
  /** Report a search change straight through — the route debounces it to the URL. */
  onSearchChange: (next: string) => void;
  /** Whether the server-side "Saved" filter (F11) is active (`?saved=1`). */
  saved: boolean;
  /**
   * Toggle the server-side "Saved" filter. Called ONLY for a signed-in viewer —
   * the chip's own auth gate opens a sign-in dialog for anonymous clicks instead.
   */
  onSavedToggle: () => void;
  /**
   * Extra controls rendered inside the Filters sheet, below the taxonomy filter —
   * the route passes the server-side sort control + pagination here so those
   * URL-driven controls stay reachable in the redesign (the bundle has no visible
   * sort/pager, but the server capability must not be lost).
   */
  sheetExtras?: React.ReactNode;
  /**
   * Whether ANY browse search param (search, quick, taxonomy attrs, saved mode,
   * sort, radius, or page) is off its default — the route computes this across the
   * WHOLE param set, not just the subset this component renders chips for.
   * Gates the trailing "Reset" chip (repo-owner mobile feedback: previously only
   * the taxonomy filter's own "Clear" existed, with no single affordance to back
   * out of a stacked search + quick filter + saved mode + sort + radius + page).
   */
  isAnyFilterActive: boolean;
  /** Reset EVERY browse search param to its default in one navigation. */
  onResetAll: () => void;
}) {
  return (
    <div className="-mx-gutter flex items-center gap-2 overflow-x-auto px-gutter pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Search leads the row as a chip (user feedback #5) — controlled by the
          route, which debounces it into the URL `?q=`. */}
      <SearchChip value={search} onChange={onSearchChange} />

      {/* Sign-in-gated "Saved" chip — the server-side favorites filter (F11). */}
      <SavedChip saved={saved} onToggle={onSavedToggle} />

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
              Show only places the community has confirmed for the attributes you pick.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <TaxonomyFilter selected={attrs} onToggle={onToggleAttr} onClear={onClearAttrs} />
            {sheetExtras}
          </div>
        </SheetContent>
      </Sheet>

      {/* Faceted quick chips (server-side, URL-driven via `?quick=`). Membership in
          the active set = pressed; the parent reducer enforces safety exclusivity. */}
      {QUICK_CHIPS.map(({ value, label, Icon }) => {
        const active = quick.includes(value);
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => onQuickToggle(value)}
            className={chipClasses(active)}
          >
            <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}

      {/* Trailing "Reset" chip (repo-owner mobile feedback): the single affordance
          to back out of every stacked browse param at once. Rendered ONLY when at
          least one is off its default — never shown on a bare visit. Always icon +
          VISIBLE text (never icon/colour-only), using the same inactive pill
          treatment as "Filters" rather than a warning colour — resetting isn't a
          destructive/alarming action. */}
      {isAnyFilterActive ? (
        <button type="button" onClick={onResetAll} className={chipClasses(false)}>
          <RotateCcw className="size-4" strokeWidth={2.25} aria-hidden="true" />
          <span>Reset</span>
        </button>
      ) : null}
    </div>
  );
}
