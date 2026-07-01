import { CommunityBanner } from "~/components/directory/CommunityBanner";
import { RestaurantCard, type RestaurantCardVM } from "~/components/listing/ListingCard";

/**
 * The List view (AUB-61, Phase 2b): an optional {@link CommunityBanner} followed
 * by a vertical stack of {@link RestaurantCard}s built from the real per-listing
 * view-models. Bottom padding clears the floating "Add a spot" FAB.
 *
 * The cards render from the SAME {@link RestaurantCardVM} the map surfaces use
 * (mapped once via `listingToCardVM`), so the safety glance is identical
 * everywhere — no divergent trust rendering between list and map.
 */
export function DirectoryList({
  cards,
  showCommunityBanner = true,
}: {
  cards: readonly RestaurantCardVM[];
  showCommunityBanner?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3.5 pb-24">
      {showCommunityBanner ? <CommunityBanner /> : null}
      <ul className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((vm) => (
          <li key={vm.id}>
            <RestaurantCard vm={vm} />
          </li>
        ))}
      </ul>
    </div>
  );
}
