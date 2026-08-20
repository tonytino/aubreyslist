import { useSuspenseQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Check, Heart, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { currentUserQuery } from "~/auth/current-user-query";
import { SearchChip } from "~/components/directory/SearchChip";
import { SortSelector } from "~/components/directory/SortSelector";
import { WheatStrike } from "~/components/icons/WheatStrike";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { QuickFilterValue } from "~/listings/quick";
import type { BrowseSort } from "~/listings/sort";
import { CLAIM_ATTRIBUTES, type ClaimAttribute } from "~/listings/taxonomy";
import { CLAIM_ATTRIBUTE_ICONS, CLAIM_ATTRIBUTE_LABELS } from "~/trust/summary";

/**
 * Horizontal-scroll filter chip row. Every control is URL-driven and
 * server-side — nothing here refines the loaded page client-side:
 *   - **Quick chips** (Celiac-safe / Gluten-friendly / Recently verified)
 *     drive `?quick=` as a faceted set: the `safety` pair (celiac / friendly)
 *     is mutually exclusive, while `recent` toggles additively. Exclusivity is
 *     enforced by the parent's `applyQuickToggle` reducer — this component
 *     renders whatever set it's handed and reports each click via
 *     `onQuickToggle`. Real `<button>`s carrying `aria-pressed` so the toggle
 *     state is announced — never colour alone.
 *   - **Taxonomy chips** are the server-side consensus filter (`?attrs=`). One
 *     toggle chip per attribute, labelled from `CLAIM_ATTRIBUTE_LABELS` with
 *     that attribute's distinct `CLAIM_ATTRIBUTE_ICONS` glyph (shape, not
 *     colour, differentiates), `aria-pressed`, reporting through
 *     `onToggleAttr`.
 *   - **Sort chip** ({@link SortSelector}) mirrors the DistanceSelector pattern
 *     (a native `<select>` styled as a chip) and drives `?sort=` via the
 *     route's `changeSort` — including the "Near me" geolocation opt-in flow.
 *
 * One Celiac-safe chip: the headline taxonomy attribute
 * (`celiac_safe_vs_gluten_friendly`) is excluded from the default taxonomy
 * chip set because the quick `celiac` chip covers the same user question with
 * a strictly safer reading — both require confirms to strictly outnumber
 * disputes on the headline claim, and the quick chip additionally requires the
 * consensus to be fresh (within the staleness window). Two side-by-side
 * "Celiac-safe" chips with near-identical semantics would be illegible. The
 * URL param still accepts the headline attr (shared links), and then the chip
 * is rendered pressed so the active filter stays visible and can be toggled
 * off.
 *
 * The free-text search leads the row as a {@link SearchChip}, controlled by
 * the route's `search`/`onSearchChange` (mirrored to `?q=` with a debounce
 * there).
 *
 * Layout: one horizontal scroll row on mobile (the mobile-first base); from
 * `sm:` up the chips wrap into multiple lines instead of scrolling, so all ~10
 * controls stay visible on wider screens without a long sideways drag.
 */

interface QuickChipDef {
  value: QuickFilterValue;
  label: string;
  Icon: LucideIcon;
}

const QUICK_CHIPS: readonly QuickChipDef[] = [
  { value: "celiac", label: "Celiac-safe", Icon: ShieldCheck },
  // Brand "gluten struck out" glyph — matches SafetySignal's `gluten-friendly`
  // icon so the same state reads with the same shape everywhere. Drop-in
  // compatible: typed as `LucideIcon`, same 24×24 box, sized/stroked
  // identically to the other chips.
  { value: "friendly", label: "Gluten-friendly", Icon: WheatStrike },
  { value: "recent", label: "Recently verified", Icon: Check },
];

/**
 * The headline taxonomy attribute, deliberately absent from the default taxonomy
 * chip set — the quick `celiac` chip is the one visible "Celiac-safe" control
 * (see the module doc). Still valid in `?attrs=` for back-compat.
 */
const HEADLINE_ATTRIBUTE: ClaimAttribute = "celiac_safe_vs_gluten_friendly";

/** Shared pill classes; `active` swaps to the filled brand treatment. */
function chipClasses(active: boolean): string {
  const base =
    "inline-flex shrink-0 items-center gap-1.5 rounded-chip border px-3 py-2 text-body-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring";
  return active
    ? `${base} border-brand bg-brand text-brand-foreground`
    : `${base} border-border bg-surface text-foreground hover:bg-brand-soft`;
}

/**
 * Build the relative post-sign-in `returnTo` for an anonymous "Saved" click:
 * the current path with `?saved=1` set, so the OAuth callback lands the diner
 * back on the directory already switched into their saved view. A relative
 * path only (the server's `validateReturnTo` rejects anything else); SSR-safe
 * via the `typeof window` guard (the chip hydrates before any anonymous
 * click).
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
 * The sign-in-gated "Saved" chip. Signed-in → toggles the server-side
 * `?saved=1` mode via `onToggle`. Anonymous → opens the same kind of Radix
 * sign-in dialog as {@link FavoriteButton} (no toggle, no server call), so an
 * anonymous viewer can never trigger a `savedOnly` request.
 *
 * Signed-in state comes from the root-prefetched {@link currentUserQuery} via
 * `useSuspenseQuery` (the repo convention), so it renders correctly on first
 * paint. Client-safe: imports only `currentUserQuery` + `ui/dialog`, never
 * `~/server/*`/`~/db`.
 */
function SavedChip({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  const { data: currentUser } = useSuspenseQuery(currentUserQuery);
  const [signInOpen, setSignInOpen] = useState(false);

  const isSignedIn = currentUser != null;
  // The saved mode is only active for a signed-in viewer; an anonymous viewer is
  // never "pressed" (colour is never the sole cue — `aria-pressed` announces it).
  const active = isSignedIn && saved;

  const handleClick = () => {
    if (!isSignedIn) {
      // Anonymous: no navigation — explain saved spots and offer sign-in.
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
              Favorites let you keep a personal list of gluten-free spots you trust. Sign in to save
              spots and filter the directory to just your saved places.
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
  quick,
  onQuickToggle,
  search,
  onSearchChange,
  saved,
  onSavedToggle,
  bot,
  onBotToggle,
  sort,
  onSortChange,
  isAnyFilterActive,
  onResetAll,
}: {
  /** The active taxonomy-attribute selection (URL-derived from `?attrs=`). */
  attrs: ClaimAttribute[];
  /**
   * Toggle a single taxonomy attribute on/off; the route maps this to a
   * `?attrs=` navigation (server-side consensus filter).
   */
  onToggleAttr: (attribute: ClaimAttribute) => void;
  /** The active quick-filter set (URL-derived). A chip is pressed iff it's a member. */
  quick: QuickFilterValue[];
  /** Report a chip click; the parent's `applyQuickToggle` computes the next set. */
  onQuickToggle: (value: QuickFilterValue) => void;
  /** Current free-text search value (the route mirrors it to `?q=`, debounced). */
  search: string;
  /** Report a search change straight through — the route debounces it to the URL. */
  onSearchChange: (next: string) => void;
  /** Whether the server-side "Saved" filter is active (`?saved=1`). */
  saved: boolean;
  /**
   * Toggle the server-side "Saved" filter. Called only for a signed-in viewer —
   * the chip's own auth gate opens a sign-in dialog for anonymous clicks instead.
   */
  onSavedToggle: () => void;
  /**
   * Whether curator-bot suggestions participate in the browse (URL-derived
   * from `?bot=`; default true). The "Hide bot suggestions" chip is pressed
   * when this is false — filters become community-evidence-only and
   * bot-suggested-only listings (live suggestion, no community evidence) are
   * hidden from the results.
   */
  bot: boolean;
  /** Toggle bot-suggestion participation; the route maps this to `?bot=`. */
  onBotToggle: () => void;
  /** The active server-side sort (URL-derived from `?sort=`). */
  sort: BrowseSort;
  /**
   * Change the sort; the route's `changeSort` maps this to a `?sort=` navigation
   * (including the "Near me" geolocation opt-in / graceful-denial flow).
   */
  onSortChange: (next: BrowseSort) => void;
  /**
   * Whether any filter-like browse search param (search, quick, taxonomy
   * attrs, saved mode, sort, radius, page, or a near-me coordinate pair) is
   * off its default — the route computes this via `isAnyBrowseFilterActive`
   * (browse-search.ts) across every server-affecting param, not just the
   * subset this component renders chips for. The one exclusion is the
   * client-only `?view=` (List/Map) toggle: Map view alone never lights the
   * Reset chip (a content-view choice, not a filter). Deliberate asymmetry:
   * when Reset is shown and clicked, its full-replace navigation still returns
   * the view to List — see `onResetAll`. Gates the trailing "Reset" chip.
   */
  isAnyFilterActive: boolean;
  /**
   * Reset every browse search param to its default in one navigation —
   * fresh-visit semantics, including the client-only `?view=` (back to List),
   * even though `?view=` alone never shows this chip (see `isAnyFilterActive`).
   */
  onResetAll: () => void;
}) {
  // The taxonomy chips to show: every attribute except the headline one — the
  // quick `celiac` chip is the single visible "Celiac-safe" control (module doc).
  // When a shared link carries the headline attr in `?attrs=`, its chip is
  // rendered (pressed) so the active filter is visible and can be toggled off —
  // an invisible active filter would be dishonest.
  const taxonomyChipAttributes = CLAIM_ATTRIBUTES.filter(
    (attribute) => attribute !== HEADLINE_ATTRIBUTE || attrs.includes(attribute)
  );

  return (
    <div className="-mx-gutter flex items-center gap-2 overflow-x-auto px-gutter pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap">
      {/* Search leads the row as a chip — controlled by the route, which
          debounces it into the URL `?q=`. */}
      <SearchChip value={search} onChange={onSearchChange} />

      {/* Sort chip — the server-side `?sort=` control, mirroring the
          DistanceSelector chip pattern. */}
      <SortSelector value={sort} onChange={onSortChange} />

      {/* Sign-in-gated "Saved" chip — the server-side favorites filter. */}
      <SavedChip saved={saved} onToggle={onSavedToggle} />

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

      {/* "Hide bot suggestions" chip: by default a live curator-bot suggestion
          also satisfies the taxonomy/quick-celiac filters (a discovery aid),
          and bot-suggested-only listings appear in the list; the card labels a
          live suggestion on any visible claim "Suggested by Aubrey's Bot" and
          badges each suggested attribute, so every suggestion match shows its
          provenance. Pressing this chip (`?bot=false`) reverts filters to
          community-evidence-only matching and hides the bot-suggested-only
          listings themselves — a live suggestion with no community evidence on
          any claim — from the results (server-side, so the honest total
          reflects it; listings with real evidence always stay). Sparkles is
          the established bot glyph (ListingCard / ClaimTrustSummary), so the
          same provenance reads with the same shape. Pressed = suggestions
          hidden (`aria-pressed`, never colour alone). */}
      <button type="button" aria-pressed={!bot} onClick={onBotToggle} className={chipClasses(!bot)}>
        <Sparkles className="size-4" strokeWidth={2.25} aria-hidden="true" />
        <span>Hide bot suggestions</span>
      </button>

      {/* Taxonomy toggle chips — the server-side consensus filter (`?attrs=`).
          Each chip carries its attribute's distinct glyph so shape (not colour)
          tells them apart, and `aria-pressed` announces the toggle state. */}
      {taxonomyChipAttributes.map((attribute) => {
        const active = attrs.includes(attribute);
        const Icon = CLAIM_ATTRIBUTE_ICONS[attribute];
        return (
          <button
            key={attribute}
            type="button"
            aria-pressed={active}
            onClick={() => onToggleAttr(attribute)}
            className={chipClasses(active)}
          >
            <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
            <span>{CLAIM_ATTRIBUTE_LABELS[attribute]}</span>
          </button>
        );
      })}

      {/* Trailing "Reset" chip: the single affordance to back out of every
          stacked browse param at once. Rendered only when at least one is off
          its default — never shown on a bare visit. Always icon + visible text
          (never icon/colour-only), using the same inactive pill treatment as
          the other chips rather than a warning colour — resetting isn't a
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
