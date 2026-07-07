import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaimAttribute } from "~/db/schema";

/**
 * Baked Denver seed DATA accessor (AUB-31).
 *
 * {@link SEED_LISTINGS} is GENERATED, not hand-written: `pnpm db:seed:refresh`
 * (`scripts/refresh-seed-data.ts`) resolves the human-curated `SEED_SOURCES`
 * (`scripts/seed-sources.ts`) against the Google Places API ONCE and writes the
 * fully-resolved entries to `scripts/seed-listings.generated.json`, which is
 * committed. This module just parses that committed JSON so the API-free
 * `pnpm db:seed` (`scripts/seed.ts`) can insert it directly — no Places call at
 * seed time.
 *
 * DO NOT hand-edit `seed-listings.generated.json`. To change the seed set, edit
 * `seed-sources.ts` (and, for a new captured field, `refresh-seed-data.ts`), then
 * re-run `pnpm db:seed:refresh` to re-bake.
 */

// Re-export the curator-bot identity so existing importers keep working — it now
// lives with the human-curated sources.
export { CURATOR_BOT } from "./seed-sources";

/** One fully-resolved (baked) seed listing, ready to insert with no API call. */
export interface SeededListing {
  /** The resolved Google Place ID (listings dedup on this). */
  placeId: string;
  /** Resolved display name. */
  name: string;
  /** Resolved formatted address. */
  address: string;
  /** Resolved latitude. */
  lat: number;
  /** Resolved longitude. */
  lng: number;
  /** The GF-attribute labels the curator bot suggests (≥1). */
  suggestedAttributes: ClaimAttribute[];
  /** Optional official menu / GF-info page, seeded as a `menu`-kind `listing_links` row (AUB-220). */
  menuUrl?: string | null;
  /** Captured Google star rating at refresh time (informational). */
  googleRating?: number | null;
  /** Captured Google rating count at refresh time (informational). */
  googleRatingCount?: number | null;
  /**
   * Google's own share link for the place (the Maps "Share" button URL),
   * captured at refresh time. Preferred as `listings.mapsUrl` when present;
   * absent (older bakes) the seeder builds a Maps URLs API link instead.
   */
  googleMapsUri?: string | null;
}

/**
 * The baked seed set, parsed from the committed `seed-listings.generated.json`.
 * Empty until `pnpm db:seed:refresh` has been run and its output committed.
 *
 * Resolve the path via `fileURLToPath` (not `new URL(..., import.meta.url)`): Vite
 * statically rewrites the latter into an asset-server URL, which breaks the read
 * under vitest. The path form works identically under plain Node and Vitest.
 */
const bakedPath = join(dirname(fileURLToPath(import.meta.url)), "seed-listings.generated.json");
export const SEED_LISTINGS: SeededListing[] = JSON.parse(readFileSync(bakedPath, "utf8"));
