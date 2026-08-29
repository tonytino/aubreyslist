/**
 * Chain-location fan-out: `pnpm db:seed:expand-chains`.
 *
 * Enumerates the other in-radius locations of every curated chain that carries
 * `chainWideAttributes` (`scripts/seed-sources.ts`), via one Places Text
 * Search per brand, and bakes them to
 * `scripts/seed-chain-locations.generated.json`. `seed-data.ts` concatenates
 * that file with the curated bake, so the API-free `pnpm db:seed` inserts
 * both.
 *
 * Attribute honesty: an expanded location inherits ONLY the brand's
 * `chainWideAttributes` — the corporate-policy subset — never the flagship's
 * full `suggestedAttributes`. Equipment/practice claims stay per-location.
 * Chains without `chainWideAttributes` do not fan out.
 *
 * Idempotent and self-healing: every run re-derives the full file, deduping
 * against the CURATED bake only (the flagship keeps its curated entry) and
 * across brands. Locations beyond the 50-mile Union Station radius are
 * dropped and logged, never guessed.
 *
 * Structure mirrors `refresh-seed-data.ts`: {@link expandChainLocations} is
 * the injectable, network-free core; {@link runCli} wires the real Text
 * Search resolver via `getPlacesApiKey()` (no `DATABASE_URL` needed).
 */

import { writeFileSync } from "node:fs";
import { getPlacesApiKey } from "~/env";
import { type Coords, haversineKm, milesToKm, UNION_STATION } from "~/listings/distance";
import { errorMessage, logSkipped, runWhenInvokedDirectly } from "./cli";
import {
  PLACES_SEARCH_URL,
  type ResolvedPlace,
  SEARCH_FIELD_MASK,
  searchTextResponseSchema,
} from "./refresh-seed-data";
import { CURATED_SEED_LISTINGS, type SeededListing } from "./seed-data";
import { SEED_SOURCES, type SeedSource } from "./seed-sources";

/** Resolves a brand name to its in-market locations (empty when none found). */
export type ChainLocationsResolver = (brand: string) => Promise<ResolvedPlace[]>;

/** Dependencies for {@link expandChainLocations}; the CLI supplies the real ones. */
export interface ExpandChainLocationsDeps {
  sources: SeedSource[];
  /** The curated bake — flagship entries and their Place IDs to dedup against. */
  curatedListings: SeededListing[];
  resolveLocations: ChainLocationsResolver;
  /** Progress sink (defaults to a no-op so tests stay quiet). */
  log?: (message: string) => void;
}

/** What a fan-out run produced: expanded listings + brands that yielded nothing. */
export interface ExpandChainLocationsResult {
  listings: SeededListing[];
  skipped: Array<{ query: string; reason: string }>;
}

/** The 50-mile fan-out radius from Union Station (same cap as the refresh). */
const MAX_RADIUS_MILES = 50;

/** The brand name a chain source is searched by: its query up to the first comma. */
export function brandOf(source: SeedSource): string {
  const [brand] = source.query.split(",");
  return (brand ?? source.query).trim();
}

/**
 * Fan every eligible chain out to its other in-radius locations. Pure
 * orchestration over the injected resolver. Throws on a miscurated source
 * (`chainWideAttributes` without `chain: true`, empty, or not a subset of
 * `suggestedAttributes`) — that is a curation bug to fix, not data to skip.
 */
export async function expandChainLocations(
  deps: ExpandChainLocationsDeps
): Promise<ExpandChainLocationsResult> {
  const { sources, curatedListings, resolveLocations, log = () => {} } = deps;

  const result: ExpandChainLocationsResult = { listings: [], skipped: [] };
  const knownPlaceIds = new Set(curatedListings.map((listing) => listing.placeId));

  for (const source of sources) {
    const chainWide = source.chainWideAttributes;
    if (chainWide === undefined) {
      continue;
    }
    if (source.chain !== true) {
      throw new Error(`"${source.query}" has chainWideAttributes but no chain: true`);
    }
    if (chainWide.length === 0) {
      throw new Error(`"${source.query}" has an empty chainWideAttributes`);
    }
    const unsupported = chainWide.filter(
      (attribute) => !source.suggestedAttributes.includes(attribute)
    );
    if (unsupported.length > 0) {
      throw new Error(
        `"${source.query}" chainWideAttributes not in suggestedAttributes: ${unsupported.join(", ")}`
      );
    }

    const brand = brandOf(source);
    const places = await resolveLocations(brand);
    let added = 0;

    for (const place of places) {
      if (knownPlaceIds.has(place.placeId)) {
        continue; // The flagship's own curated entry, or already emitted.
      }
      const coords: Coords = { lat: place.lat, lng: place.lng };
      if (haversineKm(UNION_STATION, coords) > milesToKm(MAX_RADIUS_MILES)) {
        log(`OUT-OF-RANGE ${brand}: ${place.address}`);
        continue;
      }
      knownPlaceIds.add(place.placeId);
      result.listings.push({
        placeId: place.placeId,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        suggestedAttributes: [...chainWide],
        menuUrl: source.menuUrl ?? null,
        googleMapsUri: place.googleMapsUri ?? null,
      });
      added += 1;
    }

    if (added === 0) {
      result.skipped.push({ query: source.query, reason: "no-new-in-range-locations" });
      log(`NONE  ${brand} — no new in-range locations`);
    } else {
      log(`OK    ${brand} — ${added} location(s) added`);
    }
  }

  return result;
}

/** How many results one brand search may return (Places' per-request maximum). */
const MAX_LOCATIONS_PER_BRAND = 20;

/**
 * Build the real multi-result Text Search resolver. One call per brand,
 * scoped to Colorado and biased to Union Station; the caller's 50-mile
 * haversine check is the hard range guard.
 */
export function makeChainLocationsResolver(
  apiKey: string,
  log: (message: string) => void = () => {}
): ChainLocationsResolver {
  return async (brand) => {
    let raw: unknown;
    try {
      const res = await fetch(PLACES_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": SEARCH_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: `${brand}, Colorado`,
          regionCode: "US",
          maxResultCount: MAX_LOCATIONS_PER_BRAND,
          locationBias: {
            circle: {
              center: { latitude: UNION_STATION.lat, longitude: UNION_STATION.lng },
              radius: 50000, // Places' max bias circle; the 50-mi cap is enforced by the caller
            },
          },
        }),
      });
      if (!res.ok) {
        log(`Places searchText ${res.status} for "${brand}"`);
        return [];
      }
      raw = await res.json();
    } catch (err) {
      log(
        `Places network error for "${brand}": ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }

    const parsed = searchTextResponseSchema.safeParse(raw);
    const places = parsed.success ? (parsed.data.places ?? []) : [];
    if (places.length === MAX_LOCATIONS_PER_BRAND) {
      log(`FULL-PAGE ${brand} — ${MAX_LOCATIONS_PER_BRAND} results; some locations may be missed`);
    }

    const resolved: ResolvedPlace[] = [];
    for (const place of places) {
      if (!place.location || place.formattedAddress === undefined) {
        continue;
      }
      resolved.push({
        placeId: place.id,
        name: place.displayName?.text ?? brand,
        address: place.formattedAddress,
        lat: place.location.latitude,
        lng: place.location.longitude,
        googleMapsUri: place.googleMapsUri ?? null,
      });
    }
    return resolved;
  };
}

/** Where the baked chain locations live (committed, concatenated by `seed-data.ts`). */
const OUTPUT_URL = new URL("./seed-chain-locations.generated.json", import.meta.url);

/**
 * CLI shell: wire the real resolver, fan out over `SEED_SOURCES` against the
 * curated bake, and write `seed-chain-locations.generated.json`.
 *
 * Exit codes: `0` success, `1` any failure (missing key, miscurated source,
 * network/write error, or an implausibly empty result).
 */
export async function runCli(
  deps?: Partial<ExpandChainLocationsDeps>,
  log: Pick<Console, "log" | "error"> = console
): Promise<number> {
  try {
    const resolveLocations =
      deps?.resolveLocations ??
      (() => {
        // Only the Places key — the fan-out never opens a DB connection.
        const apiKey = getPlacesApiKey();
        return makeChainLocationsResolver(apiKey, (m) => log.log(m));
      })();

    const sources = deps?.sources ?? SEED_SOURCES;
    const curatedListings = deps?.curatedListings ?? CURATED_SEED_LISTINGS;
    const eligible = sources.filter((s) => s.chainWideAttributes !== undefined).length;

    const result = await expandChainLocations({
      sources,
      curatedListings,
      resolveLocations,
      log: deps?.log ?? ((m) => log.log(m)),
    });

    // Eligible chains but zero locations across ALL of them means the API is
    // down or the key is bad — never overwrite the committed file with `[]`.
    if (eligible > 0 && result.listings.length === 0) {
      throw new Error(
        `Fan-out resolved 0 locations across ${eligible} chain(s) — refusing to overwrite the baked chain data with an empty set. Check GOOGLE_PLACES_API_KEY (auth/quota) and re-run.`
      );
    }

    writeFileSync(OUTPUT_URL, `${JSON.stringify(result.listings, null, 2)}\n`);

    log.log(
      `Fan-out complete — ${result.listings.length} location(s) across ${eligible} chain(s). Wrote seed-chain-locations.generated.json.`
    );
    logSkipped((m) => log.log(m), result.skipped);
    return 0;
  } catch (error) {
    log.error(errorMessage(error));
    return 1;
  }
}

runWhenInvokedDirectly(import.meta.url, () => runCli());
