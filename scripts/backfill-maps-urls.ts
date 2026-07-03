/**
 * Maps-URL backfill: `pnpm db:backfill:maps-urls` — API-FREE, idempotent.
 *
 * Listings created before the Maps-link fix stored `mapsUrl` in the legacy
 * `https://www.google.com/maps/place/?q=place_id:…` format, which was never a
 * documented Google Maps URL and which Maps stopped resolving — so the
 * "Open in Google Maps" link on every affected listing dead-ends. This script
 * rewrites exactly those rows to the documented Maps URLs API format
 * (`/maps/search/?api=1&query=<name address>&query_place_id=<place id>`),
 * built entirely from columns already on the row — no Places API call, no key.
 *
 * Design (mirrors `scripts/seed.ts`):
 * - The testable core is {@link backfillMapsUrls}, which takes its DB as an
 *   INJECTED dependency, so unit tests need no live DB or network.
 * - The CLI shell ({@link runCli}) wires the real `getDb()`, prints a summary,
 *   and sets the exit code.
 *
 * IDEMPOTENT: only rows still carrying the legacy prefix match; a rewritten row
 * never matches again. Re-run freely. Rows without a Place ID are reported and
 * left untouched (they should not exist — manual entries were always written in
 * the search format — but silently rewriting them would guess at data).
 *
 * Runs via `node --experimental-strip-types` + the dependency-free alias loader
 * (`scripts/register-aliases.mjs`) — no `tsx`/`ts-node` dependency, same as
 * `db:seed`.
 */

import { eq, like } from "drizzle-orm";
import { getDb } from "~/db/client";
import { listings } from "~/db/schema";

/** The real Drizzle client type, injected so tests can pass a structural mock. */
type BackfillDb = ReturnType<typeof getDb>;

/** The legacy, no-longer-resolvable link prefix this backfill exists to purge. */
export const LEGACY_MAPS_URL_PREFIX = "https://www.google.com/maps/place/?q=place_id:";

/** Dependencies for {@link backfillMapsUrls}; the CLI supplies the real ones. */
export interface BackfillMapsUrlsDeps {
  db: BackfillDb;
  /** Progress sink (defaults to a no-op so tests stay quiet). */
  log?: (message: string) => void;
}

/** What a backfill run did, for the CLI shell to report. */
export interface BackfillMapsUrlsResult {
  /** Rows rewritten to the documented Maps URLs API format. */
  updated: number;
  /** Legacy-format rows left untouched because they have no Place ID. */
  skippedNoPlaceId: number;
}

/**
 * The Google Maps deep-link for a Place ID, via the documented Maps URLs API.
 * Mirrors `buildMapsUrl` in `app/server/places.ts` — inlined (one line) so this
 * CLI never imports that module, which registers `createServerFn` entry points
 * at import time (see the identical note in `scripts/seed.ts`).
 */
function buildMapsUrl(placeId: string, query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query
  )}&query_place_id=${encodeURIComponent(placeId)}`;
}

/**
 * Rewrite every legacy-format `mapsUrl` from the row's own `placeId` + `name` +
 * `address`. Pure orchestration over the injected DB — no env/network of its own.
 */
export async function backfillMapsUrls(
  deps: BackfillMapsUrlsDeps
): Promise<BackfillMapsUrlsResult> {
  const { db, log = () => {} } = deps;

  const legacyRows = await db
    .select({
      id: listings.id,
      placeId: listings.placeId,
      name: listings.name,
      address: listings.address,
    })
    .from(listings)
    .where(like(listings.mapsUrl, `${LEGACY_MAPS_URL_PREFIX}%`));

  const result: BackfillMapsUrlsResult = { updated: 0, skippedNoPlaceId: 0 };

  for (const row of legacyRows) {
    if (row.placeId === null) {
      result.skippedNoPlaceId += 1;
      log(`SKIP  ${row.name} — legacy mapsUrl but no Place ID (${row.id})`);
      continue;
    }

    await db
      .update(listings)
      .set({ mapsUrl: buildMapsUrl(row.placeId, `${row.name} ${row.address}`.trim()) })
      .where(eq(listings.id, row.id));
    result.updated += 1;
    log(`OK    ${row.name}`);
  }

  return result;
}

/**
 * CLI shell: wire the real DB, run {@link backfillMapsUrls}, print a summary,
 * and return a process exit code. Reads `DATABASE_URL` through the validated
 * `getDb()` accessor only.
 *
 * Exit codes: `0` success (including "nothing to do"), `1` any failure.
 */
export async function runCli(
  deps?: Partial<BackfillMapsUrlsDeps>,
  log: Pick<Console, "log" | "error"> = console
): Promise<number> {
  try {
    const db = deps?.db ?? getDb();
    const result = await backfillMapsUrls({ db, log: deps?.log ?? ((m) => log.log(m)) });

    log.log(
      `Backfill complete — ${result.updated} listing(s) rewritten, ${result.skippedNoPlaceId} skipped (no Place ID).`
    );
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
