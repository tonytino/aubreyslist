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
 * Horizontal-scroll filter chip row (AUB-61, Phase 2b; flattened in AUB-198).
 *
 * The "Filter listings" bottom sheet is RETIRED (AUB-198): the taxonomy filter and
 * the sort control it hosted now live directly in this row. Every control is
 * URL-driven and server-side — nothing here refines the loaded page client-side:
 *   - **Quick chips** (Celiac-safe / Gluten-friendly / Recently verified) are
 *     URL-driven, SERVER-side filters (`?quick=`, AUB-135/AUB-140) forming a faceted
 *     SET: the `safety` pair (celiac / friendly) is mutually exclusive, while
 *     `recent` toggles additively. Exclusivity is enforced by the parent's
 *     `applyQuickToggle` reducer — this component just renders whatever set it's
 *     handed and reports each click via `onQuickToggle`. They are real `<button>`s
 *     carrying `aria-pressed` so the toggle state is announced — never colour alone.
 *   - **Taxonomy chips** are the real server-side consensus filter (`?attrs=`,
 *     issue #35), previously checkboxes inside the sheet. One toggle chip per
 *     attribute, labelled from `CLAIM_ATTRIBUTE_LABELS` with that attribute's
 *     distinct `CLAIM_ATTRIBUTE_ICONS` glyph (shape, not colour, differentiates),
 *     `aria-pressed`, reporting through `onToggleAttr` — semantics unchanged.
 *   - **Sort chip** ({@link SortSelector}) mirrors the DistanceSelector pattern (a
 *     native `<select>` styled as a chip) and drives `?sort=` via the route's
 *     `changeSort` — including the "Near me" geolocation opt-in flow.
 *
 * ONE Celiac-safe chip (AUB-198 decision): the headline taxonomy attribute
 * (`celiac_safe_vs_gluten_friendly`) is EXCLUDED from the default taxonomy chip
 * set because the quick `celiac` chip already covers the same user question with
 * a strictly SAFER reading — both require confirms to strictly outnumber disputes
 * on the same headline claim, and the quick chip additionally requires the
 * consensus to be FRESH (within the staleness window). Two side-by-side
 * "Celiac-safe" chips with near-identical semantics would be illegible. The URL
 * param still accepts the headline attr for back-compat (old shared links), and
 * when such a link arrives the chip IS rendered (pressed) so the active filter
 * stays visible and can be toggled off.
 *
 * SEARCH-AS-CHIP (user feedback #5): the free-text search leads the row as a
 * {@link SearchChip}, controlled by the route's `search`/`onSearchChange` (still
 * mirrored to the URL `?q=` with a debounce there).
 *
 * ROW LAYOUT: one horizontal scroll row on mobile (the mobile-first base); from
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
  // icon (AUB-133) so the same state reads with the same shape everywhere,
  // rather than lucide's generic `Leaf`. Drop-in compatible: typed as
  // `LucideIcon`, same 24×24 box, sized/stroked identically to the other chips.
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
   * Toggle a single taxonomy attribute on/off; the route maps this to a `?attrs=`
   * navigation (server-side consensus filter, unchanged semantics — issue #35).
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
  /** Whether the server-side "Saved" filter (F11) is active (`?saved=1`). */
  saved: boolean;
  /**
   * Toggle the server-side "Saved" filter. Called ONLY for a signed-in viewer —
   * the chip's own auth gate opens a sign-in dialog for anonymous clicks instead.
   */
  onSavedToggle: () => void;
  /**
   * Whether curator-bot suggestions PARTICIPATE in filter matching (AUB-31,
   * URL-derived from `?bot=`; default true). The "Hide bot suggestions" chip is
   * pressed when this is FALSE — i.e. filters are community-evidence-only.
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
  // The taxonomy chips to show: every attribute EXCEPT the headline one — the
  // quick `celiac` chip is the single visible "Celiac-safe" control (module doc).
  // Back-compat: when a shared/old link carries the headline attr in `?attrs=`,
  // its chip IS rendered (pressed) so the active filter is visible and can be
  // toggled off — an invisible active filter would be dishonest.
  const taxonomyChipAttributes = CLAIM_ATTRIBUTES.filter(
    (attribute) => attribute !== HEADLINE_ATTRIBUTE || attrs.includes(attribute)
  );

  return (
    <div className="-mx-gutter flex items-center gap-2 overflow-x-auto px-gutter pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap">
      {/* Search leads the row as a chip (user feedback #5) — controlled by the
          route, which debounces it into the URL `?q=`. */}
      <SearchChip value={search} onChange={onSearchChange} />

      {/* Sort chip (AUB-198) — the server-side `?sort=` control, out of the retired
          sheet and into the row, mirroring the DistanceSelector chip pattern. */}
      <SortSelector value={sort} onChange={onSortChange} />

      {/* Sign-in-gated "Saved" chip — the server-side favorites filter (F11). */}
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

      {/* "Hide bot suggestions" chip (AUB-31 filter participation): by default a
          LIVE curator-bot suggestion also satisfies the taxonomy/quick-celiac
          filters (a discovery aid). Card-cue scope (AUB-193): the card's bot
          badge covers a live suggestion on ANY visible claim while the listing
          has no real celiac evidence — so suggestion matches carry the badge
          except a listing with community celiac evidence matching a
          non-headline attr via suggestion (provenance then lives on the listing
          detail's claim rows; owner follow-up). This chip
          excludes them (`?bot=false`), reverting filters to community-evidence-
          only matching. Sparkles is the established bot glyph (ListingCard /
          ClaimTrustSummary), so the same provenance reads with the same shape.
          Pressed = suggestions HIDDEN (`aria-pressed`, never colour alone). */}
      <button type="button" aria-pressed={!bot} onClick={onBotToggle} className={chipClasses(!bot)}>
        <Sparkles className="size-4" strokeWidth={2.25} aria-hidden="true" />
        <span>Hide bot suggestions</span>
      </button>

      {/* Taxonomy toggle chips (AUB-198) — the REAL server-side consensus filter
          (`?attrs=`, issue #35), flattened out of the retired sheet. Each chip
          carries its attribute's distinct glyph so shape (not colour) tells them
          apart, and `aria-pressed` announces the toggle state. */}
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

      {/* Trailing "Reset" chip (repo-owner mobile feedback): the single affordance
          to back out of every stacked browse param at once. Rendered ONLY when at
          least one is off its default — never shown on a bare visit. Always icon +
          VISIBLE text (never icon/colour-only), using the same inactive pill
          treatment as the other chips rather than a warning colour — resetting
          isn't a destructive/alarming action. */}
      {isAnyFilterActive ? (
        <button type="button" onClick={onResetAll} className={chipClasses(false)}>
          <RotateCcw className="size-4" strokeWidth={2.25} aria-hidden="true" />
          <span>Reset</span>
        </button>
      ) : null}
    </div>
  );
}
