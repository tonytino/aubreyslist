import { Link } from "@tanstack/react-router";
import { Check, Clock, Heart, Sparkles, Star, TriangleAlert, Users } from "lucide-react";
import type { ComponentProps } from "react";
import { FavoriteButton } from "~/components/listing/FavoriteButton";
import { SafetySignal, type SafetyState } from "~/components/SafetySignal";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { Listing } from "~/db/schema";
import { cn } from "~/lib/utils";
import type { ListingTrustGlance } from "~/trust/browse-glance";

/**
 * The photo-placeholder accent (a decorative pastel gradient, never load-bearing
 * for safety meaning — see docs/agents/design.md). Phase 2 maps real data onto
 * these four options; for now the wrapper derives one deterministically from the
 * listing id so a card's tile colour stays stable across renders.
 */
export type RestaurantCardAccent = "lavender" | "peach" | "mint" | "sky";

/**
 * The render-ready view-model a {@link RestaurantCard} consumes.
 *
 * The card is PROP-DRIVEN and CLIENT-SAFE: it takes this flat, presentational
 * view-model rather than the raw DB row, so it never reaches for `db`/server-only
 * modules and stays trivially testable. Phase 2 will map real listing data into
 * this shape; this phase binds it to a fixed view-model.
 *
 * TRUST MODEL (ADR-007): `safetyState` is the ONLY safety verdict. `null` keeps
 * the honest "Not yet attested" chip — never a fabricated verdict, because a
 * celiac could be hurt. `googleRating` is an EXTERNAL Google Places rating,
 * clearly attributed, and MUST NOT be read as a safety/celiac score.
 */
export interface RestaurantCardVM {
  id: string;
  name: string;
  /** Location line (neighborhood is not in the schema yet — omitted for now). */
  address: string;
  /** e.g. "0.4 mi" — rendered only when provided. */
  distanceLabel?: string;
  /** The headline safety verdict, or `null` for the honest "Not yet attested" chip. */
  safetyState: SafetyState | null;
  /**
   * True when the headline celiac claim is a curator-bot suggestion (AUB-31) with
   * no real evidence yet — the empty state reads "Suggested by Aubrey's Bot"
   * instead of "Not yet attested". Only meaningful when `safetyState === null`.
   */
  suggestedByBot: boolean;
  /** A recent "got glutened" report flags the card regardless of confirmations. */
  hasRecentIncident: boolean;
  /** Freshness/recency cue, e.g. `{ kind: "fresh", label: "Verified 3d ago" }`. */
  freshness?: { kind: "fresh" | "stale" | "incident"; label: string };
  /** Community evidence counts, rendered as "N confirmations · M neighbors". */
  evidence?: { confirmations: number; contributors: number };
  /** Decorative photo-placeholder gradient (never a safety signal). */
  accent: RestaurantCardAccent;
  /**
   * OPTIONAL external Google Places rating. Rendered as an ATTRIBUTED pill only
   * when present — never styled or labelled as a safety/celiac score (ADR-007).
   */
  googleRating?: { value: number; count: number } | null;
  /**
   * OPTIONAL public, user-agnostic count of people who have saved this listing.
   * Rendered as an ATTRIBUTED "saves" pill only when > 0 (hidden at 0, matching
   * how `googleRating` hides when absent). Like `googleRating`, it is a community
   * signal, NOT a safety/celiac verdict (ADR-007) — all safety meaning stays in
   * {@link SafetySignal}, so this pill NEVER sits in the safety-signal row.
   */
  saveCount?: number;
  /** A real food photo when available; otherwise the placeholder tile is shown. */
  photoUrl?: string | null;
}

/**
 * Per-accent Tailwind gradient classes for the photo-placeholder tile.
 *
 * We key a fixed set of Tailwind utility classes off the `accent` value rather
 * than composing an inline `style` gradient (styling.md: no inline styles). The
 * classes are written out in full so Tailwind's Oxide scanner can see them.
 */
const ACCENT_GRADIENTS: Record<RestaurantCardAccent, string> = {
  lavender: "bg-gradient-to-br from-accent-lavender to-accent-lavender/40",
  peach: "bg-gradient-to-br from-accent-peach to-accent-peach/40",
  mint: "bg-gradient-to-br from-accent-mint to-accent-mint/40",
  sky: "bg-gradient-to-br from-accent-sky to-accent-sky/40",
};

/** Per-kind colour + icon for the freshness cue (colour + icon + label, never colour alone). */
const FRESHNESS = {
  fresh: { className: "text-celiac-safe", Icon: Check },
  stale: { className: "text-stale", Icon: Clock },
  incident: { className: "text-incident", Icon: TriangleAlert },
} as const;

/**
 * An attributed community pill — the shared shell for the save-count and
 * Google-rating pills, each wrapped in a supplementary ADR-007 tooltip.
 *
 * A real, non-submitting `<button type="button">`: a legitimately-focusable
 * `TooltipTrigger` (fires on hover AND keyboard focus) with proper interactive
 * semantics, rather than a `tabIndex`-hacked `<span>`. Tailwind's preflight already
 * strips native button chrome (transparent background, zero border), so the pill's
 * own utility classes fully define its look. Callers pass the accent `className`
 * plus `data-testid`; the pill stays a NON-safety signal (ADR-007) — its meaning
 * always lives in the visible text it wraps, never in the tooltip alone.
 */
function AttributedPill({ className, type = "button", ...props }: ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-chip px-2 py-1 text-caption font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand-ring",
        className
      )}
      {...props}
    />
  );
}

/**
 * One scannable browse-list card (issue #33, AUB-61 redesign).
 *
 * A PROP-DRIVEN, CLIENT-SAFE presentational card bound to a {@link RestaurantCardVM}.
 * The whole card is a single {@link Link} to `/listings/$id` so the entire tile is
 * one large, mobile-friendly tap target.
 *
 * ACCESSIBLE TRUST GLANCE (NON-NEGOTIABLE, docs/agents/styling.md): the safety
 * state renders via {@link SafetySignal} (colour + icon + text label — never
 * colour alone). `safetyState === null` shows an honest "Not yet attested" chip,
 * never a fabricated verdict. A recent incident adds the `incident` signal.
 *
 * TRUST MODEL (ADR-007): the optional Google rating pill is an EXTERNAL Google
 * rating, explicitly attributed ("Google"), and is NOT a safety score — all
 * safety meaning stays in {@link SafetySignal}.
 *
 * CONSISTENT HEIGHT (AUB-194): every card in a directory grid renders at the
 * same height regardless of which optional attributes its VM carries. Two
 * mechanisms, both Tailwind-only and clip-free:
 *  1. The card shell is `h-full flex flex-col` and the body (a sibling of the
 *     media Link) stretches with `flex-1`, so cards fill their grid cell and
 *     equalize within a row even when a name/address wraps to two lines — the
 *     meta row is pinned to the bottom with an `mt-auto` wrapper.
 *  2. The freshness/evidence meta row's space is ALWAYS reserved: when a VM has
 *     neither (e.g. a freshly seeded, bot-suggested listing), the row renders an
 *     `invisible` placeholder line of the same composition (icon + caption text)
 *     instead of collapsing — so a row of all-seeded cards still matches the
 *     height of fully-attested ones. Reserved space, never a fixed total height,
 *     so wrapped text is never clipped.
 *
 * CLIENT-SAFE: imports only pure/client-safe/type-only modules — no
 * `getDb`/server-only import — so it is safe in the browse route's client bundle.
 */
export function RestaurantCard({ vm }: { vm: RestaurantCardVM }) {
  const freshness = vm.freshness ? FRESHNESS[vm.freshness.kind] : null;

  return (
    // Overlay stretched-link pattern: a relatively-positioned card SHELL holds the
    // Link, whose visible content is only the MEDIA but whose `after:inset-0`
    // overlay (resolved against the shell) stretches clickability across the WHOLE
    // card — so the tile stays ONE tap target. The BODY (name, pills, safety, meta)
    // is a SIBLING of the Link in NORMAL FLOW, not a descendant of the anchor, so
    // the pills can be real interactive tooltip triggers. Non-interactive text
    // (name, address) sits BELOW the overlay so clicking it still navigates;
    // interactive siblings (pills, Heart) are raised above it with `relative z-10`.
    // No interactive/focusable element is nested inside the <a> — valid HTML.
    // The shell is also `flex h-full flex-col` (AUB-194) so the card fills its
    // grid cell and cards equalize within a row.
    <div className="group relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-card text-card-foreground shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-ring hover:shadow-md focus-within:border-brand-ring">
      {/* The anchor wraps only the media; the h3 is no longer inside it, so the
          link takes its accessible name from `aria-label`. */}
      <Link
        to="/listings/$id"
        params={{ id: vm.id }}
        aria-label={vm.name}
        className="block shrink-0 after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      >
        {/* Photo area — a real <img> when available, else the accent placeholder tile. */}
        <div className="relative h-[158px] shrink-0 overflow-hidden">
          {vm.photoUrl ? (
            <img
              src={vm.photoUrl}
              alt=""
              data-testid="food-photo"
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center ${ACCENT_GRADIENTS[vm.accent]}`}
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/50">
                Food photo
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Body — a SIBLING of the Link (NOT nested in the anchor); `flex-1` so the
          card fills its grid cell and the meta row below can pin to the bottom via
          its `mt-auto` wrapper (AUB-194). */}
      <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-3">
        {/* Title row: name (left, below the overlay so it stays click-to-navigate)
            + the attributed pills cluster (right). Both live in ONE flex row, so
            they REFLOW side-by-side and a long name can never slide under the pills
            (no absolute overlay, no magic offsets). */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 break-words font-display text-card-title font-bold text-foreground">
            {vm.name}
          </h3>

          {/* Attributed community pills (save-count + external Google rating). In
              flow in the title row, but raised above the stretched-link overlay
              with `relative z-10` so hover/focus reaches them — the ONLY reason
              they can be real tooltip triggers is that they are NOT descendants of
              the <a>. ADR-007: EXTERNAL / community signals, explicitly attributed,
              NEVER a safety verdict — all safety meaning stays in SafetySignal (a
              separate row below). Each pill's meaning lives in its visible text
              ("saves" / "Google"); the tooltip is only supplementary. */}
          {(vm.saveCount && vm.saveCount > 0) || vm.googleRating ? (
            <div className="relative z-10 flex shrink-0 items-center gap-1.5">
              {/* Public save-count — ATTRIBUTED ("saves"), hidden at 0. A distinct
                  accent (lavender) from the safety-state colours (ADR-007). */}
              {vm.saveCount && vm.saveCount > 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AttributedPill data-testid="save-count" className="bg-accent-lavender/50">
                      <Heart className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      <span>{vm.saveCount}</span>
                      <span className="font-normal text-muted-foreground">saves</span>
                    </AttributedPill>
                  </TooltipTrigger>
                  <TooltipContent>Community saves, not a safety score.</TooltipContent>
                </Tooltip>
              ) : null}

              {/* External Google Places rating — ATTRIBUTED, never a safety score (ADR-007). */}
              {vm.googleRating ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AttributedPill data-testid="google-rating" className="bg-accent-peach/50">
                      <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      <span>{vm.googleRating.value.toFixed(1)}</span>
                      <span className="font-normal text-muted-foreground">Google</span>
                    </AttributedPill>
                  </TooltipTrigger>
                  <TooltipContent>Google rating, not an Aubrey's List safety score.</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="text-body-sm text-muted-foreground">
          {vm.address}
          {vm.distanceLabel ? ` · ${vm.distanceLabel}` : ""}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {vm.safetyState ? (
            <SafetySignal state={vm.safetyState} />
          ) : vm.suggestedByBot ? (
            // Curator-bot suggestion (AUB-31): a seeded starter label, NOT a
            // verdict. Meaning is in text + icon (never colour alone) and clears
            // the moment a real user attests. Distinct from "Not yet attested".
            <Badge
              variant="outline"
              className="gap-1.5 border-accent-lavender bg-accent-lavender/30 px-2.5 py-1 text-body-sm font-medium text-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Suggested by Aubrey's Bot
            </Badge>
          ) : (
            // Honest empty state: no celiac claim / no attestation evidence yet.
            // Plain text label — meaning never rests on colour (styling.md).
            <Badge
              variant="outline"
              className="border-dashed px-2.5 py-1 text-body-sm font-medium text-muted-foreground"
            >
              Not yet attested
            </Badge>
          )}

          {/* Recent harm flags the card regardless of older confirmations. */}
          {vm.hasRecentIncident ? <SafetySignal state="incident" /> : null}
        </div>

        {/* Meta row — freshness cue (left) + evidence counts (right). ALWAYS
            rendered so every card reserves the same bottom-row height (AUB-194):
            a VM with neither signal gets an `invisible` placeholder line of the
            same composition (icon + caption text) and a transparent divider, so
            seeded/bot-suggested cards match the height of fully-attested ones
            without any content clipping. The `mt-auto` wrapper pins the row to
            the card bottom when a neighbour's name or address wraps taller. */}
        <div className="mt-auto">
          {freshness || vm.evidence ? (
            <div
              data-testid="card-meta-row"
              className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-caption"
            >
              {freshness && vm.freshness ? (
                <span
                  className={`inline-flex items-center gap-1.5 font-semibold ${freshness.className}`}
                >
                  <freshness.Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{vm.freshness.label}</span>
                </span>
              ) : (
                <span />
              )}

              {vm.evidence ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {vm.evidence.confirmations} confirmations · {vm.evidence.contributors} neighbors
                  </span>
                </span>
              ) : null}
            </div>
          ) : (
            <div
              data-testid="card-meta-row"
              className="mt-3 flex items-center justify-between gap-2 border-t border-transparent pt-3 text-caption"
            >
              {/* Invisible height-reserving placeholder: same icon size + text
                  line as the real row, hidden from paint AND the a11y tree. */}
              <span
                data-testid="card-meta-placeholder"
                aria-hidden="true"
                className="invisible inline-flex items-center gap-1.5 font-semibold"
              >
                <Clock className="h-4 w-4" aria-hidden="true" />
                <span>Not yet verified</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Save/heart affordance (F6, AUB-125). A SIBLING of the Link (not a
          descendant — a <button> inside an <a> is invalid HTML), raised above the
          stretched-link overlay with `absolute … z-10` so it stays independently
          focusable/clickable. FavoriteButton reproduces the previous inert heart's
          exact top-right position/classes and reads `["favorites"]` itself, so the
          VM stays per-user-free. */}
      <FavoriteButton listingId={vm.id} listingName={vm.name} />
    </div>
  );
}

/**
 * The stable accent palette, indexed by a hash of the listing id. A fixed 4-tuple
 * so the modulo index below is provably in-range under `noUncheckedIndexedAccess`.
 */
const ACCENTS = ["lavender", "peach", "mint", "sky"] as const satisfies readonly [
  RestaurantCardAccent,
  RestaurantCardAccent,
  RestaurantCardAccent,
  RestaurantCardAccent,
];

/**
 * Derive a STABLE accent from a listing id, so a given listing always gets the
 * same photo-placeholder colour. A tiny, dependency-free string hash (djb2) keeps
 * this pure and client-safe.
 */
function accentForId(id: string): RestaurantCardAccent {
  let hash = 5381;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  }
  // A 4-element tuple modulo 4 is 0..3 — always a defined element.
  return ACCENTS[(hash % ACCENTS.length) as 0 | 1 | 2 | 3];
}

interface ListingCardProps {
  listing: Listing;
  /** The precomputed at-a-glance trust for this listing (#33). */
  glance: ListingTrustGlance;
  /**
   * A "0.4 mi" distance label, present ONLY when the browse page is
   * distance-sorted (already derived server-side from the sort's haversine).
   * Explicitly `| undefined` so the route can forward `card.distanceLabel`
   * (optional on the server card) directly under `exactOptionalPropertyTypes`.
   */
  distanceLabel?: string | undefined;
}

/**
 * Thin wrapper preserving the browse route's call site
 * (`<ListingCard listing={…} glance={…} distanceLabel={…} />`) and mapping the
 * real {@link Listing} + {@link ListingTrustGlance} (+ an optional, already-
 * derived distance label) into the full {@link RestaurantCardVM} the card renders.
 *
 * The glance carries the ALREADY-DERIVED evidence counts and freshness cue
 * (computed server-side in the batched browse query set), so this wrapper only
 * MAPS them onto the VM — it never touches `db` or re-derives trust. `accent` is
 * a stable per-listing gradient hashed from `listing.id`; `googleRating`/`photoUrl`
 * are left undefined until a later phase supplies them.
 *
 * CLIENT-SAFE: imports only pure/client-safe/type-only modules (the `Listing`
 * type, the pure `ListingTrustGlance` type, and the presentational card) — no
 * `getDb`/server-only import — so it is safe in the browse route's client bundle.
 */
/**
 * Map the real {@link Listing} + {@link ListingTrustGlance} (+ optional distance
 * label) into the flat, client-safe {@link RestaurantCardVM} the presentational
 * card consumes.
 *
 * Exported as the SINGLE mapping site so every browse surface (the list card, the
 * map pins, and the map carousel) derives its VM the same way — no duplicated
 * trust/accent logic. The glance already carries the server-derived evidence
 * counts and freshness cue, so this only maps them onto the VM; it never touches
 * `db` or re-derives trust.
 */
export function listingToCardVM(
  listing: Listing,
  glance: ListingTrustGlance,
  distanceLabel?: string | undefined,
  saveCount?: number | undefined
): RestaurantCardVM {
  return {
    id: listing.id,
    name: listing.name,
    address: listing.address,
    safetyState: glance.safetyState,
    suggestedByBot: glance.suggestedByBot,
    hasRecentIncident: glance.hasRecentIncident,
    accent: accentForId(listing.id),
    // Already-derived on the server (batched query set); mapped straight through.
    // Each optional field is spread in ONLY when present, so the prop stays
    // truly absent (not `undefined`) under `exactOptionalPropertyTypes`.
    ...(glance.evidence ? { evidence: glance.evidence } : {}),
    ...(glance.freshness ? { freshness: glance.freshness } : {}),
    ...(distanceLabel !== undefined ? { distanceLabel } : {}),
    // The public save-count is OPTIONAL and trailing so callers that don't have
    // it (e.g. the map carousel) still compile and simply render no pill. Spread
    // in only when provided so the prop stays truly absent under
    // `exactOptionalPropertyTypes`.
    ...(saveCount !== undefined ? { saveCount } : {}),
  };
}

export function ListingCard({ listing, glance, distanceLabel }: ListingCardProps) {
  const vm = listingToCardVM(listing, glance, distanceLabel);

  return (
    <li>
      <RestaurantCard vm={vm} />
    </li>
  );
}
