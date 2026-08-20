/**
 * Denver listings seeder: `pnpm db:seed` (AUB-31) — API-FREE.
 *
 * Seeds the directory with real, Denver-proper gluten-free / celiac spots so it
 * has density before real users arrive. This command NEVER calls the Google Places
 * API: it inserts the BAKED data from `scripts/seed-listings.generated.json` (via
 * `scripts/seed-data.ts`), which `pnpm db:seed:refresh`
 * (`scripts/refresh-seed-data.ts`) captured ONCE from the human-curated
 * `SEED_SOURCES`. Each baked entry is inserted as a listing with one or more
 * GF-attribute "labels" SUGGESTED by the curator bot ("Aubrey's Bot"). Suggestions
 * live on `claims.suggestedBy` — NOT as fake community votes — so they stay out of
 * the honest confirm/dispute counts (ADR-007) and clear the instant a real user
 * attests (`castVote`).
 *
 * Design (mirrors `scripts/seed-admin.ts`):
 * - The testable core is {@link seedListings}, which takes its DB as an INJECTED
 *   dependency and its already-resolved data as an argument, so unit tests need no
 *   live DB or network.
 * - The CLI shell ({@link runCli}) wires the real `getDb()`, loads the baked
 *   `SEED_LISTINGS`, prints a summary, and sets the exit code. It reads NO Places
 *   API key — all Places access lives in the refresh script.
 *
 * IDEMPOTENT: listings dedup on the unique Place ID (`onConflictDoNothing`), and a
 * claim is only suggested if the `(listing, attribute)` slot doesn't already
 * exist — so a claim a real user has already engaged with is never re-suggested.
 * Re-run freely.
 *
 * TYPED LINKS (AUB-220): an entry's `menuUrl` is inserted as a `menu`-kind
 * `listing_links` row (`createdBy` null — no user performed the write), NEVER
 * as the legacy `listings.menu_url` column, which nothing writes post-AUB-202.
 * The link is seeded ONLY for listings this run itself inserted: on a Place-ID
 * dedup hit the whole entry is standing data users may have edited, and a
 * user-removed menu link leaves NO row behind, so `onConflictDoNothing` alone
 * could not stop a re-run from resurrecting it (it only guards against an
 * EXISTING row). Skipping existing listings entirely mirrors the retired
 * backfill's semantics: typed rows are authoritative, seed re-runs never
 * converge user-touched listings.
 *
 * Runs via `node --experimental-strip-types` + the dependency-free alias loader
 * (`scripts/register-aliases.mjs`) — no `tsx`/`ts-node` dependency, same as
 * `db:seed-admin`.
 */

import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { claims, listingLinks, listings, users } from "~/db/schema";
import { isHttpUrl } from "~/server/listings/url";
import { errorMessage, logSkipped, runWhenInvokedDirectly } from "./cli";
import { CURATOR_BOT, SEED_LISTINGS, type SeededListing } from "./seed-data";

/** The real Drizzle client type, injected so tests can pass a structural mock. */
type SeedDb = ReturnType<typeof getDb>;

/** Dependencies for {@link seedListings}; the CLI supplies the real ones. */
export interface SeedListingsDeps {
  db: SeedDb;
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
  /** `menu`-kind `listing_links` rows seeded this run (newly inserted listings only). */
  menuLinksSeeded: number;
  /** Entries skipped, with why (listing upsert failure). */
  skipped: Array<{ query: string; reason: string }>;
}

/**
 * Upsert the curator-bot user and suggest every baked listing's labels under it.
 * Pure orchestration over the injected DB — no env/network of its own.
 *
 * The bot is upserted by its sentinel `google_sub` (`onConflictDoNothing`), so it
 * is created once and reused forever; it never collides with a real Google account
 * (real subs are numeric) and is a plain `user` role (no standing admin).
 */
export async function seedListings(
  data: SeededListing[],
  deps: SeedListingsDeps
): Promise<SeedListingsResult> {
  const { db, log = () => {} } = deps;

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
    menuLinksSeeded: 0,
    skipped: [],
  };

  // 2. Per baked entry: upsert listing (Place-ID dedup) → seed its menu link
  //    (newly inserted listings only) → suggest each label.
  for (const entry of data) {
    // NOTE: the legacy `listings.menu_url` column is deliberately NOT written —
    // nothing writes it post-AUB-202. The entry's `menuUrl` becomes a typed
    // `menu`-kind `listing_links` row below instead (AUB-220).
    const inserted = await db
      .insert(listings)
      .values({
        placeId: entry.placeId,
        name: entry.name,
        address: entry.address,
        lat: entry.lat,
        lng: entry.lng,
        mapsUrl: resolveMapsUrl(entry),
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
        .where(eq(listings.placeId, entry.placeId))
        .limit(1);
      listingId = existing[0]?.id;
    }

    if (listingId === undefined) {
      // A conflict we somehow can't read back — count it once, as skipped only.
      result.skipped.push({ query: entry.name, reason: "listing-upsert-failed" });
      continue;
    }
    if (inserted[0]?.id === undefined) {
      result.listingsExisting += 1;
    }

    // Seed the typed menu link — ONLY for a listing this run itself inserted
    // (AUB-220). An EXISTING listing is never touched: `onConflictDoNothing`
    // would protect a user-edited menu row, but a user who REMOVED their menu
    // link leaves no row for it to conflict with, so inserting into existing
    // listings would resurrect deleted links on every re-seed. New listings
    // have no user history, so the insert cannot conflict in practice — the
    // guard is kept anyway (concurrent-run safety, and a user's edit between
    // our insert and this write must win). Non-http(s) values are never copied
    // into the typed table (#90), matching the retired backfill.
    if (inserted[0]?.id !== undefined && entry.menuUrl != null) {
      if (isHttpUrl(entry.menuUrl)) {
        const linkInserted = await db
          .insert(listingLinks)
          .values({ listingId, kind: "menu", url: entry.menuUrl, createdBy: null })
          .onConflictDoNothing({ target: [listingLinks.listingId, listingLinks.kind] })
          .returning({ id: listingLinks.id });
        if (linkInserted[0]?.id !== undefined) {
          result.menuLinksSeeded += 1;
        }
      } else {
        log(`SKIP  ${entry.name} — baked menuUrl is not http(s), link not seeded`);
      }
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

    log(`OK    ${entry.name} — ${entry.suggestedAttributes.length} label(s) suggested`);
  }

  return result;
}

/**
 * The `mapsUrl` to persist for a baked entry: prefer Google's own share link
 * (`googleMapsUri`, captured by the refresh — the Maps "Share" button URL),
 * guarded to https like the Places provider does (#90 scheme allowlist); fall
 * back to a built Maps URLs API link for older bakes that didn't capture it.
 */
function resolveMapsUrl(entry: SeededListing): string {
  return entry.googleMapsUri?.startsWith("https://") === true
    ? entry.googleMapsUri
    : buildMapsUrl(entry.placeId, `${entry.name} ${entry.address}`);
}

/**
 * The Google Maps deep-link for a Place ID, via the documented Maps URLs API
 * (Place ID resolved directly; `query` is the required human-readable
 * fallback). Mirrors `buildMapsUrl` in `app/server/places.ts` — inlined here
 * (one line) so the CLI never imports that module, which registers
 * `createServerFn` entry points at import time (a client/server transport
 * concern that doesn't belong in a Node script).
 */
function buildMapsUrl(placeId: string, query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query
  )}&query_place_id=${encodeURIComponent(placeId)}`;
}

/**
 * CLI shell: wire the real DB, load the baked seed data, run {@link seedListings},
 * print a summary, and return a process exit code. Kept thin; all real logic is in
 * the injectable core. Reads `DATABASE_URL` through the validated `getDb()`
 * accessor only — NO Places API key (this command never calls Places).
 *
 * Exit codes: `0` success (including the empty-baked no-op), `1` any failure.
 */
export async function runCli(
  deps?: Partial<SeedListingsDeps>,
  log: Pick<Console, "log" | "error"> = console
): Promise<number> {
  try {
    if (SEED_LISTINGS.length === 0) {
      log.log("No baked seed data — run `pnpm db:seed:refresh` first.");
      return 0;
    }

    const db = deps?.db ?? getDb();
    const result = await seedListings(SEED_LISTINGS, {
      db,
      log: deps?.log ?? ((m) => log.log(m)),
    });

    log.log(
      `Seed complete — bot=${result.botUserId} listings: +${result.listingsInserted} new, ${result.listingsExisting} existing · ${result.claimsSuggested} label(s) suggested · ${result.menuLinksSeeded} menu link(s) seeded · ${result.skipped.length} skipped.`
    );
    logSkipped((m) => log.log(m), result.skipped);
    return 0;
  } catch (error) {
    log.error(errorMessage(error));
    return 1;
  }
}

// Run when invoked directly (not when imported by tests). `getDb()`/`getEnv()` —
// and thus DATABASE_URL validation — are only touched on this path.
runWhenInvokedDirectly(import.meta.url, () => runCli());
