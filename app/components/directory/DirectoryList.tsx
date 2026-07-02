import { RestaurantCard, type RestaurantCardVM } from "~/components/listing/ListingCard";

/**
 * The List view (AUB-61, Phase 2b): a responsive grid of {@link RestaurantCard}s
 * built from the real per-listing view-models. Bottom padding clears the floating
 * "Add listing" FAB.
 *
 * FULL-WIDTH (user feedback #1): the directory shell now spans the full viewport,
 * so the grid scales up to four columns on very wide screens
 * (`md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`) to fill the extra room rather
 * than leaving a lake of whitespace beside a single narrow column.
 *
 * The cards render from the SAME {@link RestaurantCardVM} the map surfaces use
 * (mapped once via `listingToCardVM`), so the safety glance is identical
 * everywhere — no divergent trust rendering between list and map.
 */
export function DirectoryList({ cards }: { cards: readonly RestaurantCardVM[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3.5 pb-24 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {cards.map((vm) => (
        <li key={vm.id}>
          <RestaurantCard vm={vm} />
        </li>
      ))}
    </ul>
  );
}
