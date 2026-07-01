import { Link } from "@tanstack/react-router";
import { Check, Clock, Heart, Star, TriangleAlert, Users } from "lucide-react";
import { SafetySignal, type SafetyState } from "~/components/SafetySignal";
import { Badge } from "~/components/ui/badge";
import type { Listing } from "~/db/schema";
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
 * CLIENT-SAFE: imports only pure/client-safe/type-only modules — no
 * `getDb`/server-only import — so it is safe in the browse route's client bundle.
 */
export function RestaurantCard({ vm }: { vm: RestaurantCardVM }) {
  const freshness = vm.freshness ? FRESHNESS[vm.freshness.kind] : null;

  return (
    // Stretched-link pattern: a relatively-positioned card SHELL holds the Link
    // (which stretches an `after:` overlay across the whole card, so clicking
    // anywhere navigates — one large tap target) AND the Heart button as a
    // SIBLING of the Link, raised above the overlay with `relative z-10` so it
    // stays independently focusable/clickable. The button is NOT a descendant of
    // the anchor — valid HTML, no interactive-nesting a11y defect.
    <div className="group relative overflow-hidden rounded-card border border-border bg-card text-card-foreground shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-ring hover:shadow-md focus-within:border-brand-ring">
      <Link
        to="/listings/$id"
        params={{ id: vm.id }}
        className="block rounded-card after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      >
        {/* Photo area — a real <img> when available, else the accent placeholder tile. */}
        <div className="relative h-[158px] overflow-hidden">
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

        {/* Body */}
        <div className="flex flex-col gap-1 px-4 pb-4 pt-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-card-title font-bold text-foreground">{vm.name}</h3>

            {/* External Google Places rating — ATTRIBUTED, never a safety score (ADR-007). */}
            {vm.googleRating ? (
              <span
                data-testid="google-rating"
                className="inline-flex shrink-0 items-center gap-1 rounded-chip bg-accent-peach/50 px-2 py-1 text-caption font-semibold text-foreground"
              >
                <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>{vm.googleRating.value.toFixed(1)}</span>
                <span className="font-normal text-muted-foreground">Google</span>
              </span>
            ) : null}
          </div>

          <p className="text-body-sm text-muted-foreground">
            {vm.address}
            {vm.distanceLabel ? ` · ${vm.distanceLabel}` : ""}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {vm.safetyState ? (
              <SafetySignal state={vm.safetyState} />
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

          {/* Meta row — freshness cue (left) + evidence counts (right). */}
          {(freshness || vm.evidence) && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-caption">
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
          )}
        </div>
      </Link>

      {/* Save/heart affordance — present but not wired (Phase 2). A SIBLING of the
          Link (not a descendant — a <button> inside an <a> is invalid HTML), raised
          above the stretched-link overlay with `relative z-10` so it stays
          independently focusable/clickable. */}
      <button
        type="button"
        aria-label="Save this spot"
        className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-colors hover:text-brand"
      >
        <Heart className="h-4 w-4" aria-hidden="true" />
      </button>
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
}

/**
 * Thin compatibility wrapper preserving the browse route's existing call site
 * (`<ListingCard listing={…} glance={…} />`) while Phase 2 rewires the route to
 * build a full {@link RestaurantCardVM} directly.
 *
 * It maps the real {@link Listing} + {@link ListingTrustGlance} into a PARTIAL
 * view-model — `address`, `safetyState`, `hasRecentIncident`, and a stable
 * `accent` hashed from `listing.id`. `distanceLabel` / `evidence` / `freshness` /
 * `googleRating` are intentionally left undefined until Phase 2 supplies them.
 *
 * CLIENT-SAFE: imports only pure/client-safe/type-only modules (the `Listing`
 * type, the pure `ListingTrustGlance` type, and the presentational card) — no
 * `getDb`/server-only import — so it is safe in the browse route's client bundle.
 */
export function ListingCard({ listing, glance }: ListingCardProps) {
  const vm: RestaurantCardVM = {
    id: listing.id,
    name: listing.name,
    address: listing.address,
    safetyState: glance.safetyState,
    hasRecentIncident: glance.hasRecentIncident,
    accent: accentForId(listing.id),
  };

  return (
    <li>
      <RestaurantCard vm={vm} />
    </li>
  );
}
