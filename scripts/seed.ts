/**
 * Denver listings seeder: `pnpm db:seed` (AUB-31).
 *
 * Seeds the directory with real, Denver-proper gluten-free / celiac spots so it
 * has density before real users arrive. Each curated entry (`scripts/seed-data.ts`)
 * is resolved to a REAL Google Place ID + coordinates via Places Text Search, then
 * inserted as a listing with one or more GF-attribute "labels" SUGGESTED by the
 * curator bot ("Aubrey's Bot"). Suggestions live on `claims.suggestedBy` — NOT as
 * fake community votes — so they stay out of the honest confirm/dispute counts
 * (ADR-007) and clear the instant a real user attests (`castVote`).
 *
 * Design (mirrors `scripts/seed-admin.ts`):
 * - The testable core is {@link seedListings}, which takes its DB + a Places
 *   resolver as INJECTED dependencies so unit tests need no live DB or network.
 * - The CLI shell ({@link runCli}) wires the real `getDb()` + a real Text Search
 *   resolver, reads config through the validated `getEnv()` accessor (never raw
 *   `process.env`, per AGENTS.md Hard Rules), prints a summary, and sets the exit
 *   code.
 *
 * IDEMPOTENT: listings dedup on the unique Place ID (`onConflictDoNothing`), and a
 * claim is only suggested if the `(listing, attribute)` slot doesn't already
 * exist — so a claim a real user has already engaged with is never re-suggested.
 * Re-run freely (e.g. after curating the data). Anything the Places API can't
 * resolve, or that falls outside a 25-mile radius of Union Station, is SKIPPED and
 * logged rather than guessed.
 *
 * Runs via `node --experimental-strip-types` + the dependency-free alias loader
 * (`scripts/register-aliases.mjs`) — no `tsx`/`ts-node` dependency, same as
 * `db:seed-admin`.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { claims, listings, users } from "~/db/schema";
import { getEnv } from "~/env";
import { type Coords, UNION_STATION, haversineKm, milesToKm } from "~/listings/distance";
import { CURATOR_BOT, SEED_LISTINGS, type SeedListing } from "./seed-data";

/** The real Drizzle client type, injected so tests can pass a structural mock. */
type SeedDb = ReturnType<typeof getDb>;

/** A place resolved from a curated query — the fields a listing persists. */
export interface ResolvedPlace {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/** Resolves a curated query to a real place, or `null` when it can't be seeded. */
export type PlaceResolver = (query: string) => Promise<ResolvedPlace | null>;

/** Dependencies for {@link seedListings}; the CLI supplies the real ones. */
export interface SeedListingsDeps {
  db: SeedDb;
  resolvePlace: PlaceResolver;
  /** Progress sink (defaults to a no-op so tests stay quiet). */
  log?: (message: string) => void;
}

/** What a seed run did, for the CLI shell to report. */
export interface SeedListingsResult {
  botUserId: string;
  /** Listings newly inserted this run. */
  listingsInserted: number;
  /** Listings that already existed (Place-ID dedup hit) — a no-op. */
  listingsExisting: number;
  /** Curator-bot label suggestions newly created this run. */
  claimsSuggested: number;
  /** Entries skipped, with why (unresolved, out-of-range, upsert failure). */
  skipped: Array<{ query: string; reason: string }>;
}

/** The 25-mile fan-out radius from Union Station (AUB-31 scope). */
const MAX_RADIUS_MILES = 25;

/**
 * Upsert the curator-bot user and suggest every curated listing's labels under it.
 * Pure orchestration over the injected DB + resolver — no env/network of its own.
 *
 * The bot is upserted by its sentinel `google_sub` (`onConflictDoNothing`), so it
 * is created once and reused forever; it never collides with a real Google account
 * (real subs are numeric) and is a plain `user` role (no standing admin).
 */
export async function seedListings(
  data: SeedListing[],
  deps: SeedListingsDeps
): Promise<SeedListingsResult> {
  const { db, resolvePlace, log = () => {} } = deps;

  // 1. Upsert the curator bot, then read back its id (insert-or-ignore on the
  //    unique google_sub, so concurrent/repeat runs converge on one row).
  await db
    .insert(users)
    .values({ googleSub: CURATOR_BOT.googleSub, email: CURATOR_BOT.email, name: CURATOR_BOT.name })
    .onConflictDoNothing({ target: users.googleSub });

  const botRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.googleSub, CURATOR_BOT.googleSub))
    .limit(1);

  const botUserId = botRows[0]?.id;
  if (botUserId === undefined) {
    throw new Error("Failed to upsert the curator bot user.");
  }

  const result: SeedListingsResult = {
    botUserId,
    listingsInserted: 0,
    listingsExisting: 0,
    claimsSuggested: 0,
    skipped: [],
  };

  // 2. Per entry: resolve → upsert listing (Place-ID dedup) → suggest each label.
  for (const entry of data) {
    const place = await resolvePlace(entry.query);
    if (place === null) {
      result.skipped.push({ query: entry.query, reason: "unresolved-or-out-of-range" });
      log(`SKIP  ${entry.query} — no in-range Places match`);
      continue;
    }

    const inserted = await db
      .insert(listings)
      .values({
        placeId: place.placeId,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        mapsUrl: buildMapsUrl(place.placeId),
        menuUrl: entry.menuUrl ?? null,
      })
      .onConflictDoNothing({ target: listings.placeId })
      .returning({ id: listings.id });

    let listingId = inserted[0]?.id;
    if (listingId !== undefined) {
      result.listingsInserted += 1;
    } else {
      // Dedup hit — the listing already exists; read its id back by Place ID.
      const existing = await db
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.placeId, place.placeId))
        .limit(1);
      listingId = existing[0]?.id;
      result.listingsExisting += 1;
    }

    if (listingId === undefined) {
      result.skipped.push({ query: entry.query, reason: "listing-upsert-failed" });
      continue;
    }

    // Suggest each label. `onConflictDoNothing` on the (listing, attribute) unique
    // constraint means an existing claim — including one a real user has already
    // voted on (suggestedBy cleared) — is never touched or re-suggested.
    for (const attribute of entry.suggestedAttributes) {
      const claimInserted = await db
        .insert(claims)
        .values({ listingId, attribute, suggestedBy: botUserId })
        .onConflictDoNothing({ target: [claims.listingId, claims.attribute] })
        .returning({ id: claims.id });
      if (claimInserted[0]?.id !== undefined) {
        result.claimsSuggested += 1;
      }
    }

    log(`OK    ${place.name} — ${entry.suggestedAttributes.length} label(s) suggested`);
  }

  return result;
}

/**
 * The canonical Google Maps deep-link for a Place ID. Mirrors
 * `buildMapsUrl` in `app/server/places.ts` — inlined here (one line) so the CLI
 * never imports that module, which registers `createServerFn` entry points at
 * import time (a client/server transport concern that doesn't belong in a Node
 * script).
 */
function buildMapsUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

// Places API (New) Text Search — one call resolves a query to id + name + address
// + coordinates (no separate details call). We validate only what we persist.
const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const SEARCH_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location";

const searchTextResponseSchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.object({ text: z.string() }).optional(),
        formattedAddress: z.string().optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
      })
    )
    .optional(),
});

/**
 * Build the real Places Text Search resolver. Biases results toward Union Station
 * (so "Marco's" resolves to the Denver one) and REJECTS anything beyond the
 * 25-mile fan-out radius, returning `null` (skip + log) for any miss rather than
 * guessing. Deliberately un-gated by intake mode — this is an admin batch, not the
 * user intake flow, so it must not be blocked by an admin `manual` toggle.
 */
export function makePlacesResolver(
  apiKey: string,
  log: (message: string) => void = () => {}
): PlaceResolver {
  return async (query) => {
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
          textQuery: query,
          regionCode: "US",
          maxResultCount: 1,
          locationBias: {
            circle: {
              center: { latitude: UNION_STATION.lat, longitude: UNION_STATION.lng },
              radius: 40000, // ~25 mi, in metres — a bias, enforced hard below
            },
          },
        }),
      });
      if (!res.ok) {
        log(`Places searchText ${res.status} for "${query}"`);
        return null;
      }
      raw = await res.json();
    } catch (err) {
      log(
        `Places network error for "${query}": ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }

    const parsed = searchTextResponseSchema.safeParse(raw);
    const place = parsed.success ? parsed.data.places?.[0] : undefined;
    if (!place || !place.location || place.formattedAddress === undefined) {
      return null;
    }

    const coords: Coords = { lat: place.location.latitude, lng: place.location.longitude };
    if (haversineKm(UNION_STATION, coords) > milesToKm(MAX_RADIUS_MILES)) {
      log(`OUT-OF-RANGE "${query}" (> ${MAX_RADIUS_MILES} mi from Union Station)`);
      return null;
    }

    return {
      placeId: place.id,
      name: place.displayName?.text ?? query,
      address: place.formattedAddress,
      lat: coords.lat,
      lng: coords.lng,
    };
  };
}

/**
 * CLI shell: wire the real DB + Places resolver, run {@link seedListings}, print a
 * summary, and return a process exit code. Kept thin; all real logic is in the
 * injectable core. Reads `GOOGLE_PLACES_API_KEY` / `DATABASE_URL` through the
 * validated `getEnv()`/`getDb()` accessors only.
 *
 * Exit codes: `0` success, `1` any failure (missing key, DB/network error).
 */
export async function runCli(
  deps?: Partial<SeedListingsDeps>,
  log: Pick<Console, "log" | "error"> = console
): Promise<number> {
  try {
    const resolvePlace =
      deps?.resolvePlace ??
      (() => {
        const apiKey = getEnv().GOOGLE_PLACES_API_KEY;
        if (apiKey === undefined || apiKey.length === 0) {
          throw new Error(
            "GOOGLE_PLACES_API_KEY is required to resolve real Denver listings. Set it and re-run."
          );
        }
        return makePlacesResolver(apiKey, (m) => log.log(m));
      })();

    const db = deps?.db ?? getDb();
    const result = await seedListings(SEED_LISTINGS, {
      db,
      resolvePlace,
      log: deps?.log ?? ((m) => log.log(m)),
    });

    log.log(
      `Seed complete — bot=${result.botUserId} listings: +${result.listingsInserted} new, ${result.listingsExisting} existing · ${result.claimsSuggested} label(s) suggested · ${result.skipped.length} skipped.`
    );
    if (result.skipped.length > 0) {
      log.log(`Skipped: ${result.skipped.map((s) => s.query).join("; ")}`);
    }
    return 0;
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// Run when invoked directly (not when imported by tests). `getDb()`/`getEnv()` —
// and thus DATABASE_URL validation — are only touched on this path.
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
