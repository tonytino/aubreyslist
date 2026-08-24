import { Link } from "@tanstack/react-router";
import { Check, Clock, Heart, TriangleAlert, Users } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { BotProvenanceLabel } from "~/components/listing/BotProvenanceLabel";
import { ClaimBadge } from "~/components/listing/ClaimBadge";
import { FavoriteButton } from "~/components/listing/FavoriteButton";
import { SafetySignal, type SafetyState, UnattestedBadge } from "~/components/SafetySignal";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { Listing } from "~/db/schema";
import { cn } from "~/lib/utils";
import { cityFromAddress } from "~/listings/address";
import { listingPreviewLinkState } from "~/listings/photo-preview-state";
import { placePhotoProxyUrl } from "~/listings/place-photo-url";
import type { ClaimAttribute } from "~/listings/taxonomy";
// Type-only: erased at build time, so `getDb`/the Places key never enter the client bundle.
import type { PlacePhoto, PlacePhotoAttribution } from "~/server/places-photos";
import type { ListingTrustGlance } from "~/trust/browse-glance";

/**
 * Width requested from the `/api/places/photo` proxy for browse cards. The tile is 158px
 * tall, so this rung covers 2x DPR. Off-ladder widths are quantized server-side.
 */
export const CARD_PHOTO_MAX_WIDTH_PX = 640;

/**
 * Photo-placeholder accent. Decorative only — never carries safety meaning
 * (docs/agents/design.md). Derived from the listing id so the colour is stable across renders.
 */
export type RestaurantCardAccent = "lavender" | "peach" | "mint" | "sky";

/**
 * The render-ready view-model a {@link RestaurantCard} consumes. Flat and presentational,
 * never the raw DB row, so the card stays client-safe and testable.
 *
 * ADR-007: `safetyState` is the only safety verdict. `null` renders the honest
 * "Not yet attested" chip, never a fabricated verdict.
 */
export interface RestaurantCardVM {
  id: string;
  name: string;
  /**
   * City parsed from the stored address, e.g. "Denver". Absent when the address
   * has no parseable city — the location line then drops the segment. A card
   * renders the city alone; the full street address is shown on the
   * listing-detail page (the browse payload still carries it either way).
   */
  city?: string;
  /** e.g. "0.4 mi" — rendered only when provided. */
  distanceLabel?: string;
  /** The headline safety verdict, or `null` for the honest "Not yet attested" chip. */
  safetyState: SafetyState | null;
  /**
   * True when the listing carries any live (unvoted) curator-bot suggestion.
   * Provenance, not a verdict: it drives the "Suggested by Aubrey's Bot" label
   * and never alters the safety verdict.
   */
  suggestedByBot: boolean;
  /**
   * Live bot-suggested claim attributes (deduped, taxonomy order). Each renders as a
   * {@link ClaimBadge} `suggested` variant with an always-visible "AI" marker — ADR-007:
   * a suggestion must never read as a community-confirmed verdict, including for
   * touch-only users who cannot reach a hover tooltip.
   */
  suggestedAttributes: ClaimAttribute[];
  /**
   * Non-headline claim attributes with confirmed positive community consensus
   * (deduped, taxonomy order). Rendered as affirmed {@link ClaimBadge}s before the
   * suggested ones (evidence before provenance). The headline celiac attribute is
   * excluded — that is the {@link safetyState} verdict, rendered via {@link SafetySignal}.
   */
  confirmedAttributes: ClaimAttribute[];
  /** A recent "got glutened" report flags the card regardless of confirmations. */
  hasRecentIncident: boolean;
  /** Freshness/recency cue, e.g. `{ kind: "fresh", label: "Verified 3d ago" }`. */
  freshness?: { kind: "fresh" | "stale" | "incident"; label: string };
  /** Community evidence counts, rendered as "N confirmations · M neighbors". */
  evidence?: { confirmations: number; contributors: number };
  /** Decorative photo-placeholder gradient (never a safety signal). */
  accent: RestaurantCardAccent;
  /**
   * Public count of people who have saved this listing; the pill hides at 0. Meaning is
   * carried by the heart glyph + count + `aria-label` + tooltip, with no visible "saves"
   * word. ADR-007: a community signal, never a safety verdict, so it stays out of the
   * safety-signal row.
   */
  saveCount?: number;
  /** A real food photo when available; otherwise the placeholder tile is shown. */
  photoUrl?: string | null;
  /**
   * Author credits for {@link photoUrl}, required by Google's attribution terms whenever
   * a photo is shown. Absent/empty when there is no photo or no attribution data.
   */
  photoAttributions?: PlacePhotoAttribution[];
}

/**
 * Per-accent Tailwind gradient classes for the photo-placeholder tile. Fixed utility
 * classes, not inline styles (styling.md), written out in full so Tailwind's Oxide
 * scanner can see them.
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
 * The location atoms for an accessible name — `["Denver", "0.8 mi"]`, either
 * segment allowed to be absent. A surface folding location into an `aria-label`
 * joins these with commas, so it never has to unpick a rendered separator.
 */
export function cardLocationParts(vm: RestaurantCardVM): string[] {
  return [vm.city, vm.distanceLabel].filter((part): part is string => Boolean(part));
}

/**
 * The card's location line — `city · distance`, with either segment allowed to
 * be absent. Shared by the browse card and the map mini-card so the two
 * surfaces cannot disagree on what a listing's location reads as, or on how it
 * degrades. Each caller passes only its own wrapper classes.
 *
 * Overflow rule: the CITY truncates and the distance never does. The segments
 * are separate flex items (`min-w-0 truncate` / `shrink-0`) because a single
 * joined string clips from the right — on the 200px mini-card that drops the
 * distance entirely. "Greenwood Village · 12.4 mi" degrades to
 * "Greenwood Vill… · 12.4 mi".
 *
 * The line always renders: with neither segment it keeps an `invisible`
 * non-breaking space, so a card's height never depends on what it knows and an
 * unstyled render paints no stub word as content.
 *
 * The separator is `aria-hidden`, and it carries the only whitespace between the
 * segments — so a consumer that does not set its own `aria-label` would compute
 * "Denver0.8 mi". Build names from {@link cardLocationParts} instead, as both
 * callers do.
 */
export function CardLocationLine({
  vm,
  as = "p",
  className,
}: {
  vm: RestaurantCardVM;
  /** The mini-card sits inside a `<button>`, where a `<p>` is invalid HTML. */
  as?: "p" | "span";
  className?: string;
}) {
  const Wrapper = as;
  return (
    <Wrapper data-testid="card-location" className={cn("flex min-w-0 items-center", className)}>
      {cardLocationParts(vm).length > 0 ? (
        <>
          {vm.city ? <span className="min-w-0 truncate">{vm.city}</span> : null}
          {vm.city && vm.distanceLabel ? (
            <span aria-hidden="true" className="shrink-0">
              &nbsp;·&nbsp;
            </span>
          ) : null}
          {vm.distanceLabel ? <span className="shrink-0">{vm.distanceLabel}</span> : null}
        </>
      ) : (
        <span aria-hidden="true" className="invisible">
          &nbsp;
        </span>
      )}
    </Wrapper>
  );
}

/**
 * Attributed community pill — the shell for the save-count pill. A real,
 * non-submitting `<button type="button">` so the tooltip trigger is focusable with
 * proper semantics; Tailwind preflight strips native button chrome.
 * ADR-007: a non-safety signal — meaning lives in the visible content and accessible
 * name, never in the tooltip alone.
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
 * One scannable browse-list card, bound to a {@link RestaurantCardVM}. The whole card is
 * a single {@link Link} to `/listings/$id` — one large, mobile-friendly tap target.
 *
 * Trust glance (styling.md): the safety state renders via {@link SafetySignal}
 * (colour + icon + text, never colour alone). `safetyState === null` shows an honest
 * "Not yet attested" chip, never a fabricated verdict. A recent incident adds the
 * `incident` signal.
 *
 * ADR-007: the save-count pill is an attributed community signal, not a safety score;
 * all safety meaning stays in {@link SafetySignal}. Bot suggestions are provenance,
 * never evidence: a listing with live suggestions shows the "Suggested by Aubrey's Bot"
 * label in the meta row's freshness slot (a real freshness cue wins the slot) plus one
 * suggested-variant {@link ClaimBadge} per attribute.
 *
 * Consistent height: every card in a grid row renders at the same height. The shell is
 * `h-full flex flex-col` with a `flex-1` body, and the location line and meta row always
 * reserve their space — an `invisible` placeholder of the same composition when a VM has
 * no signal. Reserved space, never a fixed total height, so wrapped text is never clipped.
 * The claim row holds to that too: it is a single never-wrapping line that scrolls
 * horizontally, so a listing's badge count changes what you scroll to, not the card's
 * height.
 *
 * Client-safe: imports only pure/client-safe/type-only modules.
 */
export function RestaurantCard({ vm }: { vm: RestaurantCardVM }) {
  const freshness = vm.freshness ? FRESHNESS[vm.freshness.kind] : null;

  // A broken image (stale token, proxy 503) falls back to the gradient placeholder.
  // Storing the failed src (not a boolean) scopes the suppression to the exact image
  // that broke, so a VM update with a different `photoUrl` is unaffected.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = Boolean(vm.photoUrl) && vm.photoUrl !== failedSrc;

  return (
    // Stretched-link pattern: the Link wraps only the media, but its `after:inset-0`
    // overlay (resolved against the relative shell) makes the whole card one tap target.
    // The body is a sibling of the Link, not a descendant, so pills can be real
    // interactive tooltip triggers — no focusable element nested inside the <a>.
    // Non-interactive text sits below the overlay (clicks navigate); interactive
    // siblings are raised above it with `relative z-10`. The shell is `flex h-full
    // flex-col` so cards equalize within a grid row.
    <div className="group relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-card text-card-foreground shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-ring hover:shadow-md focus-within:border-brand-ring">
      {/* The anchor wraps only the media, so its accessible name comes from `aria-label`.
          When the card is showing a photo, its (browser-cached) URL and attribution
          names ride along as router `state` — never the URL (url-state.md) — so the
          hero can blur-up from it, credit already attached, instead of starting
          blank. Spread in only when present: `Link`'s `state` prop rejects an
          explicit `undefined` under `exactOptionalPropertyTypes`. */}
      <Link
        to="/listings/$id"
        params={{ id: vm.id }}
        aria-label={[vm.name, ...cardLocationParts(vm)].join(", ")}
        className="block shrink-0 after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        {...(showPhoto && vm.photoUrl
          ? listingPreviewLinkState(
              vm.photoUrl,
              (vm.photoAttributions ?? []).map((attribution) => attribution.displayName)
            )
          : {})}
      >
        {/* Photo area — a real <img> when available, else the stable per-listing
            accent placeholder tile. */}
        <div className="relative h-[158px] shrink-0 overflow-hidden">
          {showPhoto ? (
            <>
              <img
                src={vm.photoUrl ?? undefined}
                alt=""
                data-testid="food-photo"
                loading="lazy"
                onError={() => setFailedSrc(vm.photoUrl ?? null)}
                className="h-full w-full object-cover"
              />
              {/* Author credit (Google's attribution terms) — plain text, never a link:
                  it sits inside the stretched-link <Link>, and an <a> nested in an <a>
                  is invalid HTML. The scrim keeps the white caption legible on a light
                  photo (text-shadow alone cannot). The /65 scrim + white/85 text pairing
                  clears the 4.5:1 AA floor even over a pure-white photo (~5.6:1);
                  don't lighten either without re-checking that worst case. Both layers
                  are decorative (`aria-hidden` scrim; the credit reads normally). */}
              {vm.photoAttributions && vm.photoAttributions.length > 0 ? (
                <>
                  <div
                    aria-hidden="true"
                    data-testid="food-photo-attribution-scrim"
                    className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/65 to-transparent"
                  />
                  <p
                    data-testid="food-photo-attribution"
                    className="absolute bottom-1 right-2 max-w-[80%] truncate text-[11px] text-white/85 [text-shadow:0_1px_6px_rgba(0,0,0,0.85)]"
                  >
                    Photo:{" "}
                    {vm.photoAttributions.map((attribution) => attribution.displayName).join(", ")}
                  </p>
                </>
              ) : null}
            </>
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

      {/* Body — a sibling of the Link, not nested in the anchor; `flex-1` so the card
          fills its grid cell and the meta row can pin to the bottom via `mt-auto`. */}
      <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-3">
        {/* Title row: name (left) + the attributed pill (right) in one flex row, so a
            long name can never slide under it. */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 break-words font-display text-card-title font-bold text-foreground">
            {vm.name}
          </h3>

          {/* Public save-count — heart glyph + number, hidden at 0, no visible "saves"
              word. Meaning is carried by the glyph + count + aria-label + tooltip, never
              colour alone (styling.md). Lavender is distinct from every safety-state
              colour (ADR-007): an attributed community signal, never a safety verdict —
              all safety meaning stays in SafetySignal below. The wrapper raises it above
              the stretched-link overlay with `relative z-10` so hover/focus reaches it;
              it can be a real tooltip trigger only because it is not a descendant of
              the <a>. */}
          {vm.saveCount !== undefined && vm.saveCount > 0 ? (
            <div className="relative z-10 flex shrink-0 items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <AttributedPill
                    data-testid="save-count"
                    className="bg-accent-lavender/50"
                    aria-label={`${vm.saveCount} saves`}
                  >
                    <Heart className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    <span aria-hidden="true">{vm.saveCount}</span>
                  </AttributedPill>
                </TooltipTrigger>
                <TooltipContent>Community saves, not a safety score.</TooltipContent>
              </Tooltip>
            </div>
          ) : null}
        </div>

        {/* Location line — the shared component, so this card and the map mini-card
            cannot drift. An unparseable address yields no city, and the full street
            address stays on the detail page. */}
        <CardLocationLine vm={vm} className="text-body-sm text-muted-foreground" />

        {/* Claim row — one line that scrolls horizontally on overflow instead of
            wrapping (the `SafetySummary` hero / `FilterChips` pattern), so badge
            count changes what you scroll to, never how tall the card is: a
            one-badge and a five-badge card are the same height. Every chip in
            here is already `shrink-0` + `whitespace-nowrap`, so the row overflows
            rather than squeezing its labels. The scrollbar is hidden in both
            engines — a painted one would put the height back on the badge count.
            `min-w-0` lets the row shrink inside the flex-column body and hand its
            overflow to the scroller instead of widening the card at 375px, and
            `-mx-1 px-1 py-1` (net `mt-1 + py-1` = the old `mt-2` rhythm) keeps the
            suggested ring's gradient edge and the "AI" trigger's focus-visible ring
            inside the scroll box instead of clipped by it.

            `relative z-10`: the suggested ClaimBadge's "AI" tooltip trigger is a real
            <button>, so this row must be raised above the stretched-link overlay or
            the overlay intercepts every pointer event — hover/click silently never
            reaches the button, even though Tab-focus still works. It is also what
            lets a touch drag scroll the row rather than hitting the card link. */}
        <div
          data-testid="card-claim-row"
          className="relative z-10 -mx-1 mt-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {vm.safetyState ? (
            <SafetySignal state={vm.safetyState} />
          ) : vm.suggestedByBot ? null : (
            // Honest empty state: no evidence and nothing bot-suggested. Plain text —
            // meaning never rests on colour (styling.md). A bot-suggested empty listing
            // instead shows suggested badges plus the bot label in the meta row.
            <UnattestedBadge />
          )}

          {/* Recent harm flags the card regardless of older confirmations. */}
          {vm.hasRecentIncident ? <SafetySignal state="incident" /> : null}

          {/* Confirmed non-headline claims: affirmed ClaimBadges, rendered before the
              suggested ones (evidence before provenance) in taxonomy order — the same
              confirmed badges the listing-detail page shows. */}
          {vm.confirmedAttributes.map((attribute) => (
            <ClaimBadge key={attribute} attribute={attribute} />
          ))}

          {/* Bot-suggested claims — provenance, never evidence (ADR-007). The suggested
              variant shows an always-visible "AI" text marker: never colour/shape alone,
              never gated on a hover-only tooltip touch users cannot reach. */}
          {vm.suggestedAttributes.map((attribute) => (
            <ClaimBadge key={attribute} attribute={attribute} suggested />
          ))}
        </div>

        {/* Meta row — freshness cue (left) + evidence counts (right). The left slot
            doubles as the bot-provenance slot; a real freshness cue wins it (evidence
            over provenance). Always rendered so every card reserves the same bottom-row
            height: a VM with no signal gets an `invisible` placeholder of the same
            composition and a transparent divider. `mt-auto` pins the row to the card
            bottom when a neighbour wraps taller. */}
        <div className="mt-auto">
          {freshness || vm.evidence || vm.suggestedByBot ? (
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
              ) : vm.suggestedByBot ? (
                // Bot provenance in the freshness slot — the shared inline label
                // (one wording + treatment across browse card and map mini-card).
                <BotProvenanceLabel data-testid="bot-provenance" />
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

      {/* Save/heart affordance. A sibling of the Link (a <button> inside an <a> is
          invalid HTML), raised above the stretched-link overlay with `absolute … z-10`.
          FavoriteButton reads `["favorites"]` itself, so the VM stays per-user-free. */}
      <FavoriteButton listingId={vm.id} listingName={vm.name} />
    </div>
  );
}

/**
 * Accent palette, indexed by a hash of the listing id. A fixed 4-tuple so the modulo
 * index is provably in-range under `noUncheckedIndexedAccess`.
 */
const ACCENTS = ["lavender", "peach", "mint", "sky"] as const satisfies readonly [
  RestaurantCardAccent,
  RestaurantCardAccent,
  RestaurantCardAccent,
  RestaurantCardAccent,
];

/**
 * Derive a stable accent from a listing id, so a listing always gets the same
 * placeholder colour. A dependency-free djb2 hash keeps this pure and client-safe.
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
  /** The precomputed at-a-glance trust for this listing. */
  glance: ListingTrustGlance;
  /**
   * A "0.4 mi" distance label, present only when the browse page is distance-sorted
   * (derived server-side). Explicitly `| undefined` so the route can forward an optional
   * field directly under `exactOptionalPropertyTypes`.
   */
  distanceLabel?: string | undefined;
}

/**
 * Map a {@link Listing} + {@link ListingTrustGlance} into the client-safe
 * {@link RestaurantCardVM}.
 *
 * The single mapping site: every browse surface (list card, map pins, map carousel)
 * derives its VM here, so trust/accent logic is never duplicated. The glance already
 * carries the server-derived evidence, freshness, and suggestion data — this never
 * touches `db` or re-derives trust.
 *
 * `photo` is the render-time Google photo when the caller has one; callers without one
 * omit it and the card renders its gradient placeholder. This is the only place
 * `photoUrl`/`photoAttributions` are derived (via {@link placePhotoProxyUrl} at
 * {@link CARD_PHOTO_MAX_WIDTH_PX}), so surfaces can never disagree on the URL/width.
 *
 * `city` is derived here too (via {@link cityFromAddress}), so no surface parses the
 * address itself and none can fall back to the full street address.
 *
 * Client-safe: imports only pure/client-safe/type-only modules.
 */
export function listingToCardVM(
  listing: Listing,
  glance: ListingTrustGlance,
  distanceLabel?: string | undefined,
  saveCount?: number | undefined,
  photo?: PlacePhoto | undefined
): RestaurantCardVM {
  const city = cityFromAddress(listing.address);

  return {
    id: listing.id,
    name: listing.name,
    safetyState: glance.safetyState,
    suggestedByBot: glance.suggestedByBot,
    suggestedAttributes: glance.suggestedAttributes,
    confirmedAttributes: glance.confirmedAttributes,
    hasRecentIncident: glance.hasRecentIncident,
    accent: accentForId(listing.id),
    // Each optional field is spread in only when present, so the prop stays truly
    // absent (not `undefined`) under `exactOptionalPropertyTypes`.
    ...(city !== null ? { city } : {}),
    ...(glance.evidence ? { evidence: glance.evidence } : {}),
    ...(glance.freshness ? { freshness: glance.freshness } : {}),
    ...(distanceLabel !== undefined ? { distanceLabel } : {}),
    ...(saveCount !== undefined ? { saveCount } : {}),
    // A caller with no photo (kill switch off, manual listing, upstream miss, photos
    // not fetched) stays truly absent, so the card falls back to its gradient tile.
    ...(photo
      ? {
          photoUrl: placePhotoProxyUrl(photo.photoToken, CARD_PHOTO_MAX_WIDTH_PX),
          photoAttributions: photo.attributions,
        }
      : {}),
  };
}

/**
 * Thin list-item wrapper: maps the pair through {@link listingToCardVM} and renders
 * the presentational card in an `<li>`.
 */
export function ListingCard({ listing, glance, distanceLabel }: ListingCardProps) {
  const vm = listingToCardVM(listing, glance, distanceLabel);

  return (
    <li>
      <RestaurantCard vm={vm} />
    </li>
  );
}
