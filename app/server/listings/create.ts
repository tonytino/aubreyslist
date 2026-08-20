import * as Sentry from "@sentry/tanstackstart-react";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "~/db/client";
import { listingLinks, listings } from "~/db/schema";
import {
  type CreateListingInput,
  type CreateListingResult,
  createListingInputSchema,
} from "~/listings/create-input";
import type { ListingLinkInput } from "~/listings/links";
import { requireCurrentUser } from "~/server/auth/guards";
import { DuplicateListingError, findDuplicateListing } from "~/server/listings/dedup";
import { buildMapsUrl, runPlaceDetails } from "~/server/places";
import { enforceWriteLimit } from "~/server/rate-limit";
import { getSetting } from "~/server/settings";

// Re-exported so server code and the create tests keep one import surface;
// the client-safe definitions live in `~/listings/create-input`.
export {
  type CreateListingInput,
  type CreateListingResult,
  createListingInputSchema,
} from "~/listings/create-input";

/**
 * Server-side "add a listing" write (ADR-008).
 *
 * The single mutating entry point behind the add-listing UI. It honours the
 * admin-toggled intake mode (`getSetting('intake_mode')`): in `places` mode
 * the client submits a chosen Google Place ID and the canonical
 * name/address/lat/lng are resolved server-side from the Places provider (the
 * client never hand-fabricates those); in `manual` mode the client submits
 * those fields directly. Either way an optional set of typed links (menu,
 * gluten-free menu, website, reservations, online ordering) rides along and
 * is inserted into `listing_links` after the listing insert. The legacy
 * `listings.menu_url` column stays `null` on new rows and is kept only for
 * legacy data; the detail page falls back to it when a listing has no
 * `menu`-kind link.
 *
 * Why a server function, not a Hono route: per `docs/agents/api.md`, nothing
 * outside this app's frontend needs this write — no webhook, mobile, cron or
 * third-party caller. A server function also keeps `db` and the Places key
 * strictly server-side and needs no new dependency.
 *
 * Auth: the write is gated server-side by {@link requireCurrentUser} — a
 * UI-only check is not trusted. An anonymous caller gets a 401 before any DB
 * work.
 *
 * Dedup:
 * - Places mode: `listings.place_id` is unique. Rather than surface a
 *   constraint error, a submission for an already-listed Place ID resolves to
 *   the existing row with `created: false`, so the UI routes the user to the
 *   existing listing (ADR-008).
 * - Manual mode: entries store `placeId: null`; Postgres treats nulls as
 *   distinct, so the unique index never collides them. Before inserting, a
 *   deterministic normalized name+address match against existing manual
 *   listings ({@link findDuplicateListing}) blocks a strong match with a
 *   structured {@link DuplicateListingError} carrying the existing id/name.
 *
 * The validated input schema and the input/result types are the client-safe
 * contract in `~/listings/create-input`, re-exported above so this module and
 * its callers keep one import surface.
 */

/** The canonical, ready-to-insert shape, independent of which intake mode produced it. */
interface ResolvedListing {
  placeId: string | null;
  name: string;
  address: string;
  lat: number;
  lng: number;
  mapsUrl: string;
}

/**
 * Resolve a validated input into the canonical insert shape. The active mode
 * is read from app settings, not the client, and the rule is asymmetric —
 * manual entry is a first-class fallback in every mode (ADR-008: "the manual
 * form must always work; it is the safety net, not dead code"):
 *
 * - Manual submissions are always accepted, regardless of the active mode —
 *   this powers the wizard's "Enter manually instead" fallback while Places
 *   is the default intake.
 * - Places submissions are rejected only when the admin has degraded intake
 *   to `manual` (budget/rate-limit): disabling Places must still block the
 *   Google-backed writes it turns off.
 *
 * So the sole rejection is `input.mode === "places" && activeMode === "manual"`.
 *
 * In `places` mode the name/address/lat/lng come from the Places provider
 * (the submitted `placeId` is the only trusted field). A provider failure
 * (disabled, missing key, upstream/network) surfaces as a thrown error with
 * the provider's friendly message.
 */
async function resolveListing(input: CreateListingInput): Promise<ResolvedListing> {
  const activeMode = await getSetting("intake_mode");

  if (input.mode === "places" && activeMode === "manual") {
    throw new Error("Places search is currently disabled. Please add the restaurant manually.");
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
    mapsUrl:
      details.data.mapsUrl ||
      buildMapsUrl(
        details.data.placeId,
        `${details.data.name} ${details.data.formattedAddress}`.trim()
      ),
  };
}

/**
 * Block a manual entry that duplicates an existing manual listing on a
 * normalized name+address match.
 *
 * The query loads the visible manual candidate subset: `place_id is null`
 * (manual only — Places rows dedup on Place ID and must never block/merge a
 * manual entry) and `moderation_status = 'visible'`. The visibility filter
 * matters: a hidden/removed listing must not block a legitimate re-add and
 * must never be linked for a user who can't see it (public reads are
 * visible-only, so it would 404). This is a full scan of that subset, not a
 * SQL prefilter on the normalized key — the authoritative match runs in JS
 * ({@link findDuplicateListing}), because the NFKD diacritic fold can't be
 * replicated in SQL without `unaccent`, an extension we deliberately don't
 * add. Manual entry is the low-volume ADR-008 fallback, so the scan is
 * bounded by the manual-listing count and cheap in practice.
 *
 * Residual TOCTOU: no DB unique on normalized name+address (addresses are
 * free-form), so this read-then-write check is racier than the Places path;
 * two concurrent identical submissions can both pass. Moderation is the
 * backstop. See `dedup.ts`.
 *
 * On a match, throws {@link DuplicateListingError} with the existing id/name
 * instead of inserting.
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
 * Insert the intake-provided typed links for a freshly created listing. One
 * batched insert into `listing_links`, with the creating user recorded as
 * `createdBy` (provenance). `onConflictDoNothing` on the (listing, kind)
 * unique target keeps a race with a concurrent post-creation edit from
 * surfacing as a constraint error. No-op for an empty set.
 */
async function insertListingLinks(
  listingId: string,
  links: ListingLinkInput[] | undefined,
  createdBy: string | null
): Promise<void> {
  if (!links || links.length === 0) {
    return;
  }
  await getDb()
    .insert(listingLinks)
    .values(links.map((link) => ({ listingId, kind: link.kind, url: link.url, createdBy })))
    .onConflictDoNothing({ target: [listingLinks.listingId, listingLinks.kind] });
}

/**
 * Insert the resolved listing, handling dedup for both intake modes:
 *
 * - Places: look up any existing row for the Place ID and return it
 *   (`created: false`) instead of erroring; treat a lost concurrent-insert
 *   race as "already listed" and re-read the existing row.
 * - Manual: run the normalized name+address duplicate check and block a
 *   strong match with a {@link DuplicateListingError} before inserting.
 */
async function insertListing(resolved: ResolvedListing): Promise<CreateListingResult> {
  const db = getDb();

  // Places-mode dedup: a Place ID is canonical, so an existing visible row is
  // the listing. The `moderation_status = 'visible'` filter mirrors the
  // manual path: a hidden/removed row must never be surfaced or linked, leak
  // its metadata, or act as a `created: false` moderation-state oracle. A
  // Place ID that maps only to a hidden/removed row is treated as absent
  // here, falling through to the insert — where the `place_id` unique index
  // plus `onConflictDoNothing` still prevent a real duplicate row.
  if (resolved.placeId !== null) {
    const existing = await db.query.listings.findFirst({
      where: and(eq(listings.placeId, resolved.placeId), eq(listings.moderationStatus, "visible")),
    });
    if (existing) {
      return { listing: existing, created: false };
    }
  } else {
    // Manual-mode dedup: no Place ID, so guard on normalized name+address.
    await assertNoManualDuplicate(resolved);
  }

  // `onConflictDoNothing` on the unique place_id index makes a concurrent
  // duplicate a no-op (empty `returning`) rather than a thrown constraint
  // error. `menuUrl` is deliberately absent — new rows keep it `null`; typed
  // links go to `listing_links` instead.
  const inserted = await db
    .insert(listings)
    .values({
      placeId: resolved.placeId,
      name: resolved.name,
      address: resolved.address,
      lat: resolved.lat,
      lng: resolved.lng,
      mapsUrl: resolved.mapsUrl,
    } satisfies typeof listings.$inferInsert)
    .onConflictDoNothing({ target: listings.placeId })
    .returning();

  const row = inserted[0];
  if (row) {
    return { listing: row, created: true };
  }

  // Empty `returning` means the `place_id` unique index conflicted: a row
  // already holds this Place ID. Re-read the visible row so the caller can
  // still route the user to the existing listing.
  //
  // Edge: the conflicting row may be hidden/removed — a concurrent insert
  // lost the race to a moderated row, or (the common case) the visible-only
  // lookup above skipped an existing hidden/removed row and the insert then
  // conflicted. In both cases this visible-only re-read finds nothing, by
  // design: never return the moderated row. Surface a clear, non-leaky error
  // instead of a confusing success/null; the message is deliberately generic
  // and does not reveal the moderation state.
  if (resolved.placeId !== null) {
    const existing = await db.query.listings.findFirst({
      where: and(eq(listings.placeId, resolved.placeId), eq(listings.moderationStatus, "visible")),
    });
    if (existing) {
      return { listing: existing, created: false };
    }
    throw new Error("This place can’t be added right now. Please try again later.");
  }

  // Manual entries can't conflict (place_id is null/distinct), so an empty
  // result here is genuinely unexpected.
  throw new Error("Could not save the listing. Please try again.");
}

/**
 * Core add-listing logic, factored out of the server-function transport so it
 * is unit-testable with a mocked DB/provider. Resolves the input for the
 * active intake mode, inserts (deduping on Place ID), then records any typed
 * links on a newly created listing.
 *
 * Links are written only when `created` is true: a places pick that deduped
 * to an existing listing must not overwrite (or seed) that listing's links
 * from an intake form — the detail page's edit-links flow is the deliberate
 * surface for that.
 *
 * The auth gate lives on the {@link createListing} server function, not here,
 * keeping this helper free of session plumbing (mirrors `places.ts`).
 * `createdBy` is passed in by the gated wrappers for link provenance.
 */
export async function runCreateListing(
  input: CreateListingInput,
  createdBy: string | null = null
): Promise<CreateListingResult> {
  const resolved = await resolveListing(input);
  const result = await insertListing(resolved);
  if (result.created) {
    // Non-fatal: the listing insert has already committed, and the Neon HTTP
    // driver offers no interactive transaction to roll it back (`db.batch`
    // can't express this flow — the links depend on the dedup branch's
    // outcome). Failing here would surface an error for a listing that
    // exists, and a retry would dedup to `created: false` and drop the links
    // anyway. So degrade to success-without-links — the detail page's edit
    // dialog is the recovery path — and report the error (Sentry + server
    // logs), like the favorites read-degrade.
    try {
      await insertListingLinks(result.listing.id, input.links, createdBy);
    } catch (error) {
      console.error("[listing-links] intake links insert failed; created listing kept", error);
      Sentry.captureException(error);
    }
  }
  return result;
}

/**
 * Add-listing server function — the entry point the add-listing UI calls.
 *
 * Order of operations:
 * 1. {@link requireCurrentUser} — server-side auth gate (401 if anonymous).
 * 2. {@link enforceWriteLimit} — per-user write rate limit, after the auth
 *    gate and before the write, so an abusive burst gets a 429 while an
 *    anonymous caller still gets a 401.
 * 3. {@link runCreateListing} — resolve for the active mode + insert/dedup.
 */
export const createListing = createServerFn({ method: "POST" })
  .validator(createListingInputSchema)
  .handler(async ({ data }): Promise<CreateListingResult> => {
    const user = await requireCurrentUser();
    await enforceWriteLimit(user.id);
    return runCreateListing(data, user.id);
  });
