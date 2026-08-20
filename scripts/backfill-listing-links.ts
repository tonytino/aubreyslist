/**
 * Listing-links backfill: `pnpm db:backfill:listing-links`. API-free,
 * idempotent.
 *
 * Some listings carry their menu link in the legacy `listings.menu_url`
 * column, which nothing writes. This script inserts a `menu`-kind
 * `listing_links` row for every listing whose legacy `menuUrl` is a valid
 * http(s) URL, moving those rows onto the typed model. Built entirely from
 * columns already on each row — no network call, no key.
 *
 * It then clears the migrated `menu_url` (typed writes supersede the legacy
 * column — the same rule the edit-links server module enforces). This is what
 * makes a later "remove menu link" stick: the detail page's fallback renders
 * `menu_url` whenever no typed row exists, so a lingering legacy value would
 * resurrect a link users deleted. The column is also cleared when the typed
 * row already existed (insert conflict) — the typed row is authoritative
 * either way, and the user-edited URL in it is never overwritten.
 *
 * Structure:
 * - {@link backfillListingLinks} is the testable core with an injected DB, so
 *   unit tests need no live database or network.
 * - {@link runCli} wires the real `getDb()`, prints a summary, and sets the
 *   exit code.
 *
 * Idempotent: the insert is `onConflictDoNothing` on the (listing, kind)
 * unique constraint, so a listing that already has a menu-kind row — from a
 * prior run or a real user's edit — never has its URL touched or overwritten,
 * and a migrated row (menu_url cleared) is not selected again. Re-run freely.
 * `createdBy` stays null (no user performed this write). Rows whose legacy
 * value is not http(s) are reported and left fully untouched, never guessed —
 * a dangerous-scheme URL must not be copied into the typed table.
 *
 * Runs via `node --experimental-strip-types` plus the dependency-free alias
 * loader (`scripts/register-aliases.mjs`).
 */

import { eq, isNotNull } from "drizzle-orm";
import { getDb } from "~/db/client";
import { listingLinks, listings } from "~/db/schema";
import { isHttpUrl } from "~/server/listings/url";
import { errorMessage, runWhenInvokedDirectly } from "./cli";

/** The real Drizzle client type, injected so tests can pass a structural mock. */
type BackfillDb = ReturnType<typeof getDb>;

/** Dependencies for {@link backfillListingLinks}; the CLI supplies the real ones. */
export interface BackfillListingLinksDeps {
  db: BackfillDb;
  /** Progress sink (defaults to a no-op so tests stay quiet). */
  log?: (message: string) => void;
}

/** What a backfill run did, for the CLI shell to report. */
export interface BackfillListingLinksResult {
  /** Menu-kind rows inserted into `listing_links`. */
  inserted: number;
  /** Listings that already had a menu-kind row (conflict no-op). */
  alreadyLinked: number;
  /** Legacy values left untouched because they are not http(s) URLs. */
  skippedNotHttp: number;
}

/**
 * Insert a `menu`-kind `listing_links` row for every listing carrying a legacy
 * http(s) `menuUrl` and no existing menu-kind row, then clear the migrated
 * `menu_url` (the typed row is authoritative from here on). Pure orchestration
 * over the injected DB — no env/network of its own.
 */
export async function backfillListingLinks(
  deps: BackfillListingLinksDeps
): Promise<BackfillListingLinksResult> {
  const { db, log = () => {} } = deps;

  const legacyRows = await db
    .select({
      id: listings.id,
      name: listings.name,
      menuUrl: listings.menuUrl,
    })
    .from(listings)
    .where(isNotNull(listings.menuUrl));

  const result: BackfillListingLinksResult = {
    inserted: 0,
    alreadyLinked: 0,
    skippedNotHttp: 0,
  };

  for (const row of legacyRows) {
    if (!isHttpUrl(row.menuUrl)) {
      result.skippedNotHttp += 1;
      log(`SKIP  ${row.name} — legacy menuUrl is not http(s) (${row.id})`);
      continue;
    }

    // `onConflictDoNothing` on the (listing, kind) unique constraint makes a
    // listing that already carries a menu-kind row a no-op — idempotent, and a
    // real user's edited link is never overwritten. `returning` distinguishes
    // an actual insert from the conflict no-op for honest reporting.
    const inserted = await db
      .insert(listingLinks)
      .values({
        listingId: row.id,
        kind: "menu",
        url: row.menuUrl,
        createdBy: null,
      })
      .onConflictDoNothing({ target: [listingLinks.listingId, listingLinks.kind] })
      .returning({ id: listingLinks.id });

    if (inserted.length > 0) {
      result.inserted += 1;
      log(`OK    ${row.name}`);
    } else {
      result.alreadyLinked += 1;
      log(`HAVE  ${row.name} — menu link already present`);
    }

    // Typed writes supersede the legacy column (the edit-links module enforces
    // the same rule): once a typed menu row exists — whether this run inserted
    // it or one already existed — clear `menu_url` so the detail page's legacy
    // fallback can never resurrect a link a user later removes. Never reached
    // for skipped non-http rows, which stay fully untouched.
    await db.update(listings).set({ menuUrl: null }).where(eq(listings.id, row.id));
  }

  return result;
}

/**
 * CLI shell: wire the real DB, run {@link backfillListingLinks}, print a
 * summary, and return a process exit code. Reads `DATABASE_URL` through the
 * validated `getDb()` accessor only.
 *
 * Exit codes: `0` success (including "nothing to do"), `1` any failure.
 */
export async function runCli(
  deps?: Partial<BackfillListingLinksDeps>,
  log: Pick<Console, "log" | "error"> = console
): Promise<number> {
  try {
    const db = deps?.db ?? getDb();
    const result = await backfillListingLinks({ db, log: deps?.log ?? ((m) => log.log(m)) });

    log.log(
      `Backfill complete — ${result.inserted} menu link(s) inserted, ` +
        `${result.alreadyLinked} already linked, ${result.skippedNotHttp} skipped (not http/https).`
    );
    return 0;
  } catch (error) {
    log.error(errorMessage(error));
    return 1;
  }
}

// Run when invoked directly (not when imported by tests). `getDb()`/`getEnv()` —
// and thus DATABASE_URL validation — are only touched on this path.
runWhenInvokedDirectly(import.meta.url, () => runCli());
