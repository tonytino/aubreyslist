import { Link } from "@tanstack/react-router";
import { SafetySignal } from "~/components/SafetySignal";
import type { Listing } from "~/db/schema";
import type { ListingTrustGlance } from "~/trust/browse-glance";

interface ListingCardProps {
  listing: Listing;
  /** The precomputed at-a-glance trust for this listing (#33). */
  glance: ListingTrustGlance;
}

/**
 * One scannable browse-list card (issue #33).
 *
 * Shows the restaurant name, its address, and the key GF signals AT A GLANCE,
 * then links to the listing-detail page. The whole card is a single link
 * (`Link` wrapping the content) so the entire card is one large, mobile-friendly
 * tap target.
 *
 * ACCESSIBLE TRUST GLANCE (NON-NEGOTIABLE, docs/agents/styling.md): the safety
 * state is rendered via {@link SafetySignal}, which always pairs COLOUR + ICON +
 * TEXT LABEL — never colour alone. When there is no evidence we show an honest
 * "Not yet attested" chip (plain text), never a fabricated verdict (a celiac
 * could be hurt). A recent "got glutened" incident adds the `incident` warning
 * signal regardless of any confirmations (ADR-007, domain.md → Trust Model).
 *
 * CLIENT-SAFE: imports only pure/client-safe modules (the `SafetySignal`
 * component, a type-only `Listing`, and the pure `ListingTrustGlance` type) — no
 * `getDb`/server-only import — so it is safe in the browse route's client bundle.
 */
export function ListingCard({ listing, glance }: ListingCardProps) {
  const { safetyState, hasRecentIncident } = glance;

  return (
    <li>
      <Link
        to="/listings/$id"
        params={{ id: listing.id }}
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-gutter transition-colors hover:border-brand-ring focus-visible:border-brand-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
      >
        <div className="flex flex-col gap-1">
          <h3 className="text-title font-semibold text-foreground">{listing.name}</h3>
          <p className="text-body-sm text-muted-foreground">{listing.address}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {safetyState ? (
            <SafetySignal state={safetyState} />
          ) : (
            // Honest empty state: no celiac claim / no attestation evidence yet.
            // Plain text label — meaning never rests on colour (styling.md).
            <span className="inline-flex items-center rounded-chip border border-dashed border-border bg-background px-2.5 py-1 text-body-sm font-medium text-muted-foreground">
              Not yet attested
            </span>
          )}

          {/* Recent harm flags the card regardless of older confirmations. */}
          {hasRecentIncident ? <SafetySignal state="incident" /> : null}
        </div>
      </Link>
    </li>
  );
}
