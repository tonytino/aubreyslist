import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { BotProvenanceLabel } from "~/components/listing/BotProvenanceLabel";
import { ClaimBadge } from "~/components/listing/ClaimBadge";
import { FavoriteButton } from "~/components/listing/FavoriteButton";
import { ActivityLine, HappyPatrons } from "~/components/listing/ListingActivity";
import { SafetySignal, type SafetyState } from "~/components/SafetySignal";
import type { Listing } from "~/db/schema";
import { cn } from "~/lib/utils";
import { cityFromAddress } from "~/listings/address";
import { listingPreviewLinkState } from "~/listings/photo-preview-state";
import { placePhotoProxyUrl } from "~/listings/place-photo-url";
import type { ClaimAttribute } from "~/listings/taxonomy";
// Type-only: erased at build time, so `getDb`/the Places key never enter the client bundle.
import type { PlacePhoto, PlacePhotoAttribution } from "~/server/places-photos";
import type { ListingTrustGlance } from "~/trust/browse-glance";
import type { ListingActivityMeta } from "~/trust/summary";

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
 * ADR-007: `safetyState` is the only safety verdict. `null` (unattested or
 * disputed) renders no safety badge at all, never a fabricated verdict.
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
  /** The headline safety verdict, or `null` (unattested or disputed) for no badge. */
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
  /**
   * The meta row's content: the "Updated 3 days ago" activity line (or the
   * honest "No activity yet" empty state) plus the happy-patron count. Always
   * present, because the meta row always renders — every card has the same
   * anatomy whatever it knows.
   *
   * Activity, never a verdict (ADR-007): the line reports claim activity, shows
   * for a contested listing too, and says so in its tooltip. The safety reading
   * stays entirely in {@link safetyState}.
   */
  activity: ListingActivityMeta;
  /** Decorative photo-placeholder gradient (never a safety signal). */
  accent: RestaurantCardAccent;
  /**
   * Public count of people who have saved this listing; the count hides at 0. It is
   * carried by the {@link FavoriteButton} itself — one control, one concept
   * (AUB-300) — which widens from a heart circle to a heart + number pill and folds
   * the count into its accessible name. ADR-007: a community signal, never a safety
   * verdict, so it stays out of the safety-signal row.
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
 * joined string clips from the right — on the narrow map mini-card that drops the
 * distance entirely. "Greenwood Village · 12.4 mi" degrades to
 * "Greenwood Vill… · 12.4 mi".
 *
 * The line always renders: with neither segment it keeps an `invisible`
 * non-breaking space, so a card's height never depends on what it knows and an
 * unstyled render paints no stub word as content.
 *
 * Only the `·` is `aria-hidden`; its surrounding spaces are not. The browse
 * card's line sits outside the labelled `<a>`, so read-mode lands on the spans
 * directly and needs the word boundary. Surfaces that fold location into an
 * `aria-label` build it from {@link cardLocationParts}, never from this markup.
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
            <span className="shrink-0">
              &nbsp;<span aria-hidden="true">·</span>&nbsp;
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
 * One scannable browse-list card, bound to a {@link RestaurantCardVM}. The whole card is
 * a single {@link Link} to `/listings/$id` — one large, mobile-friendly tap target.
 *
 * Trust glance (styling.md): the safety state renders via {@link SafetySignal}
 * (colour + icon + text, never colour alone). `safetyState === null` — unattested or
 * disputed — shows no safety badge, never a fabricated verdict. A recent incident adds
 * the `incident` signal.
 *
 * ADR-007: the save count rides on the heart ({@link FavoriteButton}) as an attributed
 * community signal, not a safety score; all safety meaning stays in
 * {@link SafetySignal}. Bot suggestions are provenance, never evidence: a listing with
 * live suggestions shows the "Suggested by Aubrey's Bot" label in the meta row's right
 * slot (a happy-patron count wins the slot) plus one suggested-variant
 * {@link ClaimBadge} per attribute.
 *
 * Uniform anatomy (AUB-300): every card renders the same SIX slots in the same order —
 * media, name, location, signals row, divider, meta row — whatever the listing knows.
 * Nothing is conditionally added to or removed from the stack; only what sits INSIDE a
 * slot varies. The signals row keeps its band even with no chips to show, the divider is
 * always opaque structure, and the meta row is never a reserved blank: a listing with no
 * attestations reads "No activity yet". Activity is not safety, so the line carries a
 * tooltip saying so ({@link ActivityLine}).
 *
 * Consistent height: every card in a grid row renders at the same height. The shell is
 * `h-full flex flex-col` with a `flex-1` body; the name is clamped to two lines, the
 * location line always reserves its space (an `invisible` placeholder of the same
 * composition when a VM has no location), and the signals row has a fixed minimum
 * height. Reserved space, never a fixed total height, so wrapped text is never clipped.
 * The signals row holds to that too: it is a single never-wrapping line that scrolls
 * horizontally, so a listing's badge count changes what you scroll to, not the card's
 * height.
 *
 * Client-safe: imports only pure/client-safe/type-only modules.
 */
export function RestaurantCard({ vm }: { vm: RestaurantCardVM }) {
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
            // `bg-white` is the gradient's opaque base, not a theme colour: the
            // ramp's `/40` end stop composites over whatever sits behind it, so
            // without a fixed base it dissolved into the near-black `bg-card` in
            // dark mode. The accent pastels are deliberately NOT re-pointed for
            // dark mode, so pinning the base keeps the tile the same light
            // surface in both themes — light mode renders byte-identically (the
            // card was already white) and dark mode stops eating the caption.
            <div
              data-testid="photo-placeholder"
              className={`flex h-full w-full items-center justify-center bg-white ${ACCENT_GRADIENTS[vm.accent]}`}
            >
              {/* Fixed ink, never a theme-following one: the tile it sits on does
                  not follow the theme either. `text-foreground/50` inverted to
                  near-white here in dark mode (~1.3:1); `text-accent-ink` is
                  >= 9.2:1 on every accent, in both themes. */}
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-ink">
                Food photo
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Body — a sibling of the Link, not nested in the anchor; `flex-1` so the card
          fills its grid cell and the meta row can pin to the bottom via `mt-auto`. */}
      {/* No `gap-*`: each slot owns its own top margin, so the vertical rhythm is
          stated per gap (media→name 12 via `pt-3`, name→location 2, location→signals
          10, signals→divider 12, divider→meta 12, meta→edge 12 via `pb-3`) rather
          than being a shared gap plus a pile of corrections. */}
      <div className="flex flex-1 flex-col px-4 pb-3 pt-3">
        {/* Name — the whole title slot. Nothing shares this row (AUB-300): the save
            count moved onto the heart, so a long name can no longer reflow anything.
            `line-clamp-2` caps it at two lines so a 60-character name cannot make one
            card taller than its neighbours; the FULL name stays in the media link's
            `aria-label` above, so nothing is lost to AT or to search. `break-words`
            keeps an unbroken long token inside the card instead of widening it. */}
        <h3 className="line-clamp-2 break-words font-display text-card-title font-bold text-foreground">
          {vm.name}
        </h3>

        {/* Location line — the shared component, so this card and the map mini-card
            cannot drift. An unparseable address yields no city, and the full street
            address stays on the detail page. */}
        <CardLocationLine vm={vm} className="mt-0.5 text-body-sm text-muted-foreground" />

        {/* Signals row — one line that scrolls horizontally on overflow instead of
            wrapping (the `SafetySummary` hero / `FilterChips` pattern), so badge
            count changes what you scroll to, never how tall the card is: a
            one-badge and a five-badge card are the same height. Every chip in
            here is already `shrink-0` + `whitespace-nowrap`, so the row overflows
            rather than squeezing its labels. The scrollbar is hidden in both
            engines — a painted one would put the height back on the badge count.
            `min-w-0` lets the row shrink inside the flex-column body and hand its
            overflow to the scroller instead of widening the card at 375px, and
            `-mx-1 px-1 py-1` keeps the suggested ring's gradient edge and the "AI"
            trigger's focus-visible ring inside the scroll box instead of clipped
            by it.

            `min-h-[38px]` is the slot, not the content: 30px (the badge family's
            rendered height — `py-1` + a `text-body-sm` line + the chip border) plus
            this row's own 4px focus-ring bleed top and bottom. A card with NO chips
            keeps the identical band, so an unattested card and a five-chip card are
            the same object at the same height (owner-approved empty band, AUB-300).

            The right-edge fade tells the truth about overflow: the same 16px mask
            the map mini-card already carries, so a clipped label reads as
            scrollable rather than truncated — and the two surfaces cannot drift.

            Fixed chip order, left to right: the headline verdict, then the incident
            add-on, then confirmed claims (evidence), then bot suggestions
            (provenance). The "Suggested by Aubrey's Bot" label is NOT part of this
            row — it stays in the meta row's right slot (owner decision, AUB-300).

            `relative z-10`: the suggested ClaimBadge's "AI" tooltip trigger is a real
            <button>, so this row must be raised above the stretched-link overlay or
            the overlay intercepts every pointer event — hover/click silently never
            reaches the button, even though Tab-focus still works. It is also what
            lets a touch drag scroll the row rather than hitting the card link. */}
        <div
          data-testid="card-claim-row"
          className="relative z-10 -mx-1 mt-1.5 flex min-h-[38px] min-w-0 items-center gap-2 overflow-x-auto px-1 py-1 [mask-image:linear-gradient(to_right,black_calc(100%_-_16px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {/* No verdict (unattested or disputed) renders nothing here: the two are
              indistinguishable by design. A bot-suggested listing still shows its
              suggested badges plus the bot label in the meta row. */}
          {vm.safetyState ? <SafetySignal state={vm.safetyState} /> : null}

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

        {/* Meta row — the activity line (left) + the happy-patron count (right).
            ALWAYS rendered, with a real divider and real content: every card has the
            same six-slot anatomy (media, name, location, signals row, divider, meta
            row) whatever it knows, so a suggestion-only card and a heavily-attested
            one read as the same object. A listing nobody has attested says "No
            activity yet" rather than reserving an invisible line. `mt-auto` pins the
            row to the card bottom when a neighbour wraps taller.

            The right slot falls back to the bot-provenance label when there are no
            happy patrons to report — evidence over provenance.

            `relative z-10`: the activity line is a real tooltip <button>, so the row
            must sit above the stretched-link overlay or the overlay swallows the tap. */}
        <div className="mt-auto">
          <div
            data-testid="card-meta-row"
            // `mt-2` + the signals row's own 4px focus-ring bleed = the spec's 12px
            // gap to the divider; `pt-3` is the spec's 12px from divider to meta.
            className="relative z-10 mt-2 flex items-center justify-between gap-2 border-t border-border pt-3 text-caption"
          >
            <ActivityLine meta={vm.activity} />

            {vm.activity.happyPatronsLabel !== null ? (
              <HappyPatrons meta={vm.activity} />
            ) : vm.suggestedByBot ? (
              // Bot provenance — the shared inline label (one wording + treatment
              // across browse card and map mini-card).
              <BotProvenanceLabel data-testid="bot-provenance" />
            ) : null}
          </div>
        </div>
      </div>

      {/* Save/heart affordance, carrying the public save count (AUB-300: one control,
          one concept — the separate lavender count pill is gone and the title row is
          name-only). A sibling of the Link (a <button> inside an <a> is invalid HTML),
          raised above the stretched-link overlay with `absolute … z-10`.
          FavoriteButton reads `["favorites"]` itself, so the VM stays per-user-free. */}
      <FavoriteButton listingId={vm.id} listingName={vm.name} saveCount={vm.saveCount} />
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
 * carries the server-derived verdict, activity strip, and suggestion data — this never
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
    // Always threaded, never optional: the meta row is part of every card's
    // anatomy, and the glance always carries an honest (possibly empty) strip.
    activity: glance.activity,
    accent: accentForId(listing.id),
    // Each optional field is spread in only when present, so the prop stays truly
    // absent (not `undefined`) under `exactOptionalPropertyTypes`.
    ...(city !== null ? { city } : {}),
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
