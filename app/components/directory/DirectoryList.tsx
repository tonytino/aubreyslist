import { RestaurantCard, type RestaurantCardVM } from "~/components/listing/ListingCard";

/**
 * The List view: a responsive grid of {@link RestaurantCard}s built from the
 * real per-listing view-models.
 *
 * Vertical space below the grid belongs to the enclosing page.
 *
 * The directory shell spans the full viewport, so the grid scales up to four
 * columns on very wide screens (`md:grid-cols-2 xl:grid-cols-3
 * 2xl:grid-cols-4`) rather than leaving a lake of whitespace beside a single
 * narrow column.
 *
 * The cards render from the same {@link RestaurantCardVM} the map surfaces use
 * (mapped once via `listingToCardVM`), so the safety glance is identical
 * everywhere — no divergent trust rendering between list and map.
 */
export function DirectoryList({ cards }: { cards: readonly RestaurantCardVM[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {cards.map((vm) => (
        <li key={vm.id}>
          <RestaurantCard vm={vm} />
        </li>
      ))}
    </ul>
  );
}
