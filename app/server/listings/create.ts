import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "~/db/client";
import { listings } from "~/db/schema";
import {
  type CreateListingInput,
  type CreateListingResult,
  createListingInputSchema,
} from "~/listings/create-input";
import { requireCurrentUser } from "~/server/auth/guards";
import { DuplicateListingError, findDuplicateListing } from "~/server/listings/dedup";
import { buildMapsUrl, runPlaceDetails } from "~/server/places";
import { enforceWriteLimit } from "~/server/rate-limit";
import { getSetting } from "~/server/settings";

// Re-exported so server code and the existing create tests keep one import
// surface; the client-safe definitions live in `~/listings/create-input` (#141).
export {
  type CreateListingInput,
  type CreateListingResult,
  createListingInputSchema,
} from "~/listings/create-input";

/**
 * Server-side "add a listing" write (issue #26, ADR-008).
 *
 * The single mutating entry point behind the add-listing UI. It honours the
 * admin-toggled intake mode (`getSetting('intake_mode')`): in `places` mode the
 * client submits a chosen Google Place ID and the canonical name/address/lat/lng
 * are resolved server-side from the Places provider (the client never gets to
 * hand-fabricate those); in `manual` mode the client submits the
 * name/address/lat/lng directly. Either way an optional menu-link URL rides
 * along.
 *
 * Why a server function (not a Hono route): per `docs/agents/api.md`, the
 * decision rule turns on "could anything outside this app's frontend ever need
 * this data?" — no. The add-listing form is the only consumer; there is no
 * webhook / mobile / cron / third-party caller. That points at a Layer 1 server
 * function, which also keeps `db` + the Places key strictly server-side and
 * needs no new dependency (`@hono/zod-validator` would otherwise be required).
 *
 * Auth: the write is gated server-side by {@link requireCurrentUser} — a UI-only
 * check is not trusted. An anonymous caller throws `401` before any DB work.
 *
 * Dedup (issue #25):
 * - **Places mode** — `listings.place_id` is UNIQUE. Rather than surface a
 *   constraint error, a submission for an already-listed Place ID resolves to the
 *   existing row and returns it with `created: false`, so the UI can route the
 *   user to the listing that already exists (ADR-008).
 * - **Manual mode** — entries store `placeId: null`; Postgres treats NULLs as
 *   distinct, so the unique index never collides them. Before inserting we run a
 *   deterministic normalized name+address match against existing manual listings
 *   ({@link findDuplicateListing}) and BLOCK a strong match with a structured
 *   {@link DuplicateListingError} (carrying the existing listing's id/name so the
 *   UI can link to it) instead of silently creating a duplicate.
 *
 * The validated input schema (`createListingInputSchema`) and the
 * `CreateListingInput` / `CreateListingResult` types are the client-safe contract
 * and live in `~/listings/create-input` (#141); they are imported + re-exported
 * above so this module — and its callers — keep one import surface.
 */

/** The canonical, ready-to-insert shape, independent of which intake mode produced it. */
interface ResolvedListing {
  placeId: string | null;
  name: string;
  address: string;
  lat: number;
  lng: number;
  mapsUrl: string;
  /** Optional external menu link (no uploads in v1, ADR-008); `null` when blank. */
  menuUrl: string | null;
}

/**
 * Resolve a validated input into the canonical insert shape for the **active**
 * intake mode. The active mode is read from app settings, not taken from the
 * client: a `places` submission while intake is `manual` (or vice-versa) is
 * rejected, so the client can never bypass an admin's degradation toggle.
 *
 * In `places` mode the name/address/lat/lng are fetched from the Places provider
 * (the submitted `placeId` is the only trusted field). A provider failure
 * (disabled, missing key, upstream/network) is surfaced as a thrown error
 * carrying the provider's friendly message.
 */
async function resolveListing(input: CreateListingInput): Promise<ResolvedListing> {
  const activeMode = await getSetting("intake_mode");

  if (input.mode !== activeMode) {
    throw new Error(
      `Listing intake is currently in "${activeMode}" mode. Please use the ${activeMode} form to add a listing.`
    );
  }

  if (input.mode === "manual") {
    return {
      placeId: null,
      name: input.name.trim(),
      address: input.address.trim(),
      lat: input.lat,
      lng: input.lng,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${input.name} ${input.address}`
      )}`,
      menuUrl: input.menuUrl ?? null,
    };
  }

  const details = await runPlaceDetails({ placeId: input.placeId });
  if (!details.ok) {
    // Surface the provider's friendly, key-safe message (never the raw upstream error).
    throw new Error(details.message);
  }

  return {
    placeId: details.data.placeId,
    name: details.data.name,
    address: details.data.formattedAddress,
    lat: details.data.lat,
    lng: details.data.lng,
    mapsUrl: details.data.mapsUrl || buildMapsUrl(details.data.placeId),
    menuUrl: input.menuUrl ?? null,
  };
}

/**
 * Block a manual entry that duplicates an existing manual listing on a
 * normalized name+address match (issue #25).
 *
 * The query loads the **visible manual** candidate subset — `place_id IS NULL`
 * (manual only; Places rows dedup on Place ID and must never block/merge a manual
 * entry) AND `moderation_status = 'visible'`. The visibility filter matters: a
 * moderator-`hidden`/`removed` listing must NOT block a legitimate re-add and must
 * never be surfaced to / linked for a user who can't even see it (public reads are
 * visible-only → they'd 404, #41). This is a full scan of that subset, NOT a true
 * SQL prefilter on the normalized key — the authoritative name AND address match
 * runs in JS ({@link findDuplicateListing}), because `normalizeForDedup`'s NFKD
 * diacritic fold can't be replicated in SQL without `unaccent` (a DB extension we
 * deliberately don't add). Manual entry is the low-volume ADR-008 fallback, so the
 * scan is bounded by the manual-listing count and cheap in practice.
 *
 * Residual TOCTOU: there is no DB unique on normalized name+address (by design —
 * addresses are free-form), so this read-then-write check is racier than the
 * Places path; two concurrent identical manual submissions can both pass. Such
 * slipped-through dups are moderatable after the fact (#41). See `dedup.ts`.
 *
 * On a match we throw a {@link DuplicateListingError} (carrying the existing
 * id/name) instead of inserting.
 */
async function assertNoManualDuplicate(resolved: ResolvedListing): Promise<void> {
  const db = getDb();

  const candidates = await db.query.listings.findMany({
    where: and(isNull(listings.placeId), eq(listings.moderationStatus, "visible")),
  });

  const duplicate = findDuplicateListing(
    { name: resolved.name, address: resolved.address },
    candidates
  );
  if (duplicate) {
    throw new DuplicateListingError(duplicate);
  }
}

/**
 * Insert the resolved listing, handling dedup for both intake modes (issue #25):
 *
 * - **Places** — first look up any existing row for the Place ID and return it
 *   (`created: false`) instead of erroring, and guard the race where a concurrent
 *   insert wins by treating the resulting conflict as "already listed" and
 *   re-reading the existing row.
 * - **Manual** — run a normalized name+address duplicate check and BLOCK a strong
 *   match with a {@link DuplicateListingError} before inserting.
 */
async function insertListing(resolved: ResolvedListing): Promise<CreateListingResult> {
  const db = getDb();

  // Places-mode dedup: a Place ID is canonical, so an existing row IS the listing.
  if (resolved.placeId !== null) {
    const existing = await db.query.listings.findFirst({
      where: eq(listings.placeId, resolved.placeId),
    });
    if (existing) {
      return { listing: existing, created: false };
    }
  } else {
    // Manual-mode dedup: no Place ID, so guard on normalized name+address.
    await assertNoManualDuplicate(resolved);
  }

  // `onConflictDoNothing` on the unique place_id index makes a concurrent
  // duplicate a no-op (empty `returning`) rather than a thrown constraint error.
  const inserted = await db
    .insert(listings)
    .values({
      placeId: resolved.placeId,
      name: resolved.name,
      address: resolved.address,
      lat: resolved.lat,
      lng: resolved.lng,
      mapsUrl: resolved.mapsUrl,
      menuUrl: resolved.menuUrl ?? null,
    } satisfies typeof listings.$inferInsert)
    .onConflictDoNothing({ target: listings.placeId })
    .returning();

  const row = inserted[0];
  if (row) {
    return { listing: row, created: true };
  }

  // Empty `returning` ⇒ a concurrent insert already took this Place ID. Re-read
  // it so the caller still routes the user to the (now-existing) listing.
  if (resolved.placeId !== null) {
    const existing = await db.query.listings.findFirst({
      where: eq(listings.placeId, resolved.placeId),
    });
    if (existing) {
      return { listing: existing, created: false };
    }
  }

  // Manual entries can't conflict (place_id is null/distinct), so an empty
  // result here is genuinely unexpected.
  throw new Error("Could not save the listing. Please try again.");
}

/**
 * Core add-listing logic, factored out of the server-function transport so it is
 * directly unit-testable with a mocked DB / provider. Resolves the input for the
 * active intake mode, then inserts (deduping on Place ID).
 *
 * NOTE: the auth gate lives on the {@link createListing} server function, not
 * here — keeping this helper pure of session plumbing mirrors `places.ts`
 * (`runAutocomplete` / `runPlaceDetails`).
 */
export async function runCreateListing(input: CreateListingInput): Promise<CreateListingResult> {
  const resolved = await resolveListing(input);
  return insertListing(resolved);
}

/**
 * Add-listing server function — the entry point the add-listing UI calls.
 *
 * Order of operations:
 * 1. {@link requireCurrentUser} — server-side auth gate (throws 401 if anonymous).
 * 2. {@link enforceWriteLimit} — per-user write rate limit (issue #18), applied
 *    immediately AFTER the auth gate and BEFORE the write so an abusive burst is
 *    capped (throws 429) while an anonymous caller still gets a 401, not a 429.
 * 3. {@link runCreateListing} — resolve for the active intake mode + insert/dedup.
 */
export const createListing = createServerFn({ method: "POST" })
  .validator(createListingInputSchema)
  .handler(async ({ data }): Promise<CreateListingResult> => {
    const user = await requireCurrentUser();
    await enforceWriteLimit(user.id);
    return runCreateListing(data);
  });
