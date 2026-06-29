import { createServerFn } from "@tanstack/react-start";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/db/client";
import { type Listing, listings } from "~/db/schema";
import { requireCurrentUser } from "~/server/auth/guards";
import { DuplicateListingError, findDuplicateListing } from "~/server/listings/dedup";
import { isHttpUrl } from "~/server/listings/url";
import { buildMapsUrl, runPlaceDetails } from "~/server/places";
import { enforceWriteLimit } from "~/server/rate-limit";
import { getSetting } from "~/server/settings";

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
 */

/** Result of an add-listing write: the listing plus whether it was newly created. */
export interface CreateListingResult {
  listing: Listing;
  /** `false` when a places-mode submission resolved to an already-existing listing. */
  created: boolean;
}

/**
 * Validated input for the add-listing write. A discriminated union on `mode`:
 *
 * - `places`: the client sends only the chosen `placeId`; canonical fields are
 *   resolved server-side, so the client cannot spoof name/address/coords.
 * - `manual`: the client sends the canonical fields directly.
 *
 * `menuUrl` is optional in both modes; an empty string is normalised to
 * `undefined` so a blank field stores `null` rather than `""`.
 *
 * The scheme is restricted to http(s) ({@link isHttpUrl}): `z.string().url()`
 * alone accepts `javascript:`/`data:` URLs, which — rendered into the detail
 * page's anchor `href` — is a stored-XSS / untrusted-navigation vector (#90).
 */
const optionalMenuUrl = z
  .union([
    z
      .string()
      .url("Enter a valid URL (including https://).")
      .max(2048)
      .refine(isHttpUrl, "Menu URL must start with http:// or https://."),
    z.literal(""),
  ])
  .optional()
  .transform((value) => (value ? value : undefined));

export const createListingInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("places"),
    placeId: z.string().min(1, "placeId is required"),
    menuUrl: optionalMenuUrl,
  }),
  z.object({
    mode: z.literal("manual"),
    name: z.string().min(1, "Name is required").max(256),
    address: z.string().min(1, "Address is required").max(512),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    menuUrl: optionalMenuUrl,
  }),
]);
export type CreateListingInput = z.infer<typeof createListingInputSchema>;

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
 * We narrow in SQL to **manual rows only** (`place_id IS NULL`) and let the
 * deterministic JS rule ({@link findDuplicateListing}) make the authoritative
 * name AND address decision. The match logic lives entirely in `normalizeForDedup`
 * (NFKD diacritic folding, punctuation collapse, lowercase) — replicating that
 * exactly in SQL is brittle (Postgres `lower()` doesn't fold diacritics without
 * `unaccent`, a DB extension we deliberately don't add), so the query just selects
 * the manual subset and JS owns the rule. Manual entry is the low-volume fallback
 * path (ADR-008), so scanning that subset is cheap. On a match we throw a
 * {@link DuplicateListingError} (carrying the existing id/name) instead of
 * inserting.
 *
 * Places-sourced rows are excluded: they dedup on Place ID, and a manual entry
 * should never be blocked by — or merged into — a Places listing.
 */
async function assertNoManualDuplicate(resolved: ResolvedListing): Promise<void> {
  const db = getDb();

  const candidates = await db.query.listings.findMany({
    where: isNull(listings.placeId),
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
