import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { LINK_KINDS } from "~/listings/links";
import { CLAIM_ATTRIBUTES } from "~/listings/taxonomy";

// Single source of truth for the Aubrey's List domain schema.
// Run `pnpm db:generate` after changes, then `pnpm db:migrate` to apply.
//
// Conventions:
// - Primary keys are text IDs generated app-side via `crypto.randomUUID()`
//   (`$defaultFn`), so inserts never need to pass an id and the scheme stays
//   portable across any Postgres (no DB-side uuid dependency). `app_settings`
//   is the exception: its PK is a semantic `key`.
// - All tables carry `created_at`; mutable rows also carry `updated_at`.
// - Enums are declared with `pgEnum` so Postgres enforces membership at the DB
//   level (mirrored by the exported `*.enumValues` tuples for app-side reuse).

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** User roles — see ADR-010. New accounts default to `user`. */
export const userRole = pgEnum("user_role", ["admin", "moderator", "user"]);

/**
 * The fixed, curated GF attribute taxonomy (domain.md). Not user-extensible
 * in v1. Each value maps 1:1 to a taxonomy item; keep this in lockstep with
 * the taxonomy list, the filter UI, and any seed data when it changes.
 */
export const claimAttribute = pgEnum("claim_attribute", CLAIM_ATTRIBUTES);

/**
 * The fixed typed-link taxonomy for a listing: menu, gluten-free menu,
 * website, reservations, online ordering. Derives from the client-safe
 * `LINK_KINDS` tuple (`app/listings/links.ts`) exactly like `claim_attribute`
 * derives from `CLAIM_ATTRIBUTES`, so the DB and the client share one ordered
 * list. Declaration order is render order (an enum column sorts by it).
 */
export const listingLinkKind = pgEnum("listing_link_kind", LINK_KINDS);

/** A single user's vote on a claim — confirm or dispute. */
export const attestationValue = pgEnum("attestation_value", ["confirm", "dispute"]);

/** Optional severity of a reported "got glutened" reaction. */
export const incidentSeverity = pgEnum("incident_severity", ["mild", "moderate", "severe"]);

/** Moderation flag lifecycle status. */
export const flagStatus = pgEnum("flag_status", ["open", "reviewing", "resolved", "dismissed"]);

/**
 * Content moderation state. Applied per content row
 * (listings/claims/incidents) and default `visible`. Both non-visible states
 * are soft — content is never hard-deleted, so every action is fully
 * reversible and fully audited:
 *
 * - `visible` — public (the default; the only state public reads surface).
 * - `hidden` — a reversible takedown (a moderator may `restore` it to visible).
 * - `removed` — a terminal moderator decision (still soft; `restore`-able, but
 *   the intended end state for genuinely-abusive content).
 */
export const moderationStatus = pgEnum("moderation_status", ["visible", "hidden", "removed"]);

/**
 * The moderation actions a moderator/admin can take on flagged content — the
 * audit-trail verbs written to `moderation_actions`:
 *
 * - `dismiss` — the flag was reviewed and needs no content change (flag →
 *   `dismissed`; content untouched).
 * - `hide` — reversible takedown (content → `hidden`; flag → `resolved`).
 * - `remove` — terminal takedown (content → `removed`; flag → `resolved`).
 * - `restore` — undo a hide/remove (content → `visible`).
 */
export const moderationAction = pgEnum("moderation_action", [
  "dismiss",
  "hide",
  "remove",
  "restore",
]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** Google-authenticated accounts. Identity anchors on `googleSub`. */
export const users = pgTable("users", {
  id: id(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: userRole("role").notNull().default("user"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Restaurants. Canonical identity is the Google Place ID (dedup key).
 *
 * `placeId` is nullable but UNIQUE: Postgres treats NULLs as distinct, so the
 * unique constraint enforces "one listing per Place ID" for Places-sourced
 * entries while allowing many manual entries (placeId = NULL) to coexist.
 * Manual-entry dedup (match on name + address) is enforced in application code
 * at intake time (see ADR-008), not by a DB constraint, because addresses are
 * free-form and not reliably unique.
 */
export const listings = pgTable("listings", {
  id: id(),
  placeId: text("place_id").unique(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  mapsUrl: text("maps_url").notNull(),
  menuUrl: text("menu_url"),
  // Moderation state. Default `visible`; public reads filter to visible.
  moderationStatus: moderationStatus("moderation_status").notNull().default("visible"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Typed links on a listing, one row per (listing, kind) — enforced by the
 * unique constraint. New writes land here; the legacy `listings.menu_url`
 * column remains for old rows, and the detail page falls back to it when no
 * `menu`-kind row exists.
 *
 * Wiki-style: any signed-in user may save/remove a listing's links (a
 * deliberate product decision — no ownership check), moderated like other
 * content. Rows are mutable (the URL can be edited), hence `updatedAt`.
 *
 * `createdBy` is provenance for moderation/abuse investigation only — never
 * an authorization key. `set null` on the user's deletion keeps the link.
 */
export const listingLinks = pgTable(
  "listing_links",
  {
    id: id(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    kind: listingLinkKind("kind").notNull(),
    url: text("url").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("listing_links_listing_kind_unique").on(table.listingId, table.kind),
    index("listing_links_listing_idx").on(table.listingId),
  ]
);

/**
 * Community-attested statements about a listing, one row per (listing,
 * attribute). The unique constraint guarantees a single claim per attribute per
 * listing; confirm/dispute counts live in `attestations`.
 */
export const claims = pgTable(
  "claims",
  {
    id: id(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    attribute: claimAttribute("attribute").notNull(),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    // Curator-seed provenance: non-null ⇒ this claim was suggested by a
    // seed/curator user ("Aubrey's Bot") and is pending community
    // confirmation. Not community evidence: deliberately kept out of the
    // confirm/dispute counts (there is no attestation row) and surfaced only
    // as a "Suggested by Aubrey's Bot" badge (ADR-007: the honest counts
    // never treat a suggestion as a vote). Cleared to null the moment a real
    // user attests the claim (`castVote`), so a bot suggestion never lingers
    // over real evidence. `set null` on the referenced user's deletion keeps
    // the claim; it loses only its suggestion provenance.
    suggestedBy: text("suggested_by").references(() => users.id, { onDelete: "set null" }),
    // Moderation state. Default `visible`; public reads filter to visible.
    moderationStatus: moderationStatus("moderation_status").notNull().default("visible"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("claims_listing_attribute_unique").on(table.listingId, table.attribute),
    index("claims_listing_idx").on(table.listingId),
  ]
);

/**
 * A user's confirm/dispute on a claim. One vote per user per claim, enforced by
 * the unique constraint; a user changes their vote by updating the row and
 * retracts by deleting it.
 */
export const attestations = pgTable(
  "attestations",
  {
    id: id(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: attestationValue("value").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("attestations_claim_user_unique").on(table.claimId, table.userId),
    index("attestations_claim_idx").on(table.claimId),
    index("attestations_user_idx").on(table.userId),
  ]
);

/**
 * A user's favorite (bookmark) of a listing. A create-or-delete edge: a user
 * favorites a listing (one row) and unfavorites by deleting it — the row is
 * never mutated, so there is no `updatedAt`. One favorite per user per listing,
 * enforced by the unique constraint.
 */
export const favorites = pgTable(
  "favorites",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("favorites_user_listing_unique").on(t.userId, t.listingId),
    index("favorites_user_idx").on(t.userId),
    index("favorites_listing_idx").on(t.listingId),
  ]
);

/**
 * A "got glutened here" report on a listing. `occurredOn` is required; severity
 * and note are optional. Carries `updatedAt` because users may edit/retract
 * their own incidents (domain.md, Roles).
 */
export const incidents = pgTable(
  "incidents",
  {
    id: id(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    occurredOn: date("occurred_on").notNull(),
    severity: incidentSeverity("severity"),
    note: text("note"),
    // Moderation state. Default `visible`; public reads filter to visible.
    moderationStatus: moderationStatus("moderation_status").notNull().default("visible"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("incidents_listing_idx").on(table.listingId),
    index("incidents_user_idx").on(table.userId),
  ]
);

/** Admin-tunable runtime config (intake mode, staleness window, ...). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

/**
 * A user report that a listing / claim / incident is inappropriate, spam, or
 * wrong. Feeds the moderation queue.
 *
 * The target is modeled as an exclusive arc: exactly one of `listingId`,
 * `claimId`, `incidentId` is set, enforced by the `flags_one_target` CHECK.
 * Each is a real FK with `onDelete: cascade`, so a flag can never dangle or
 * point at the wrong table, and deleting content auto-removes its flags — no
 * orphan cleanup or app-side referential validation needed. Trade-off: a new
 * flaggable entity type means a migration (new nullable FK column + extended
 * CHECK), not just an enum value.
 */
export const flags = pgTable(
  "flags",
  {
    id: id(),
    listingId: text("listing_id").references(() => listings.id, { onDelete: "cascade" }),
    claimId: text("claim_id").references(() => claims.id, { onDelete: "cascade" }),
    incidentId: text("incident_id").references(() => incidents.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: flagStatus("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "flags_one_target",
      sql`num_nonnulls(${table.listingId}, ${table.claimId}, ${table.incidentId}) = 1`
    ),
    index("flags_listing_idx").on(table.listingId),
    index("flags_claim_idx").on(table.claimId),
    index("flags_incident_idx").on(table.incidentId),
    index("flags_status_idx").on(table.status),
    index("flags_reporter_idx").on(table.reporterId),
  ]
);

/**
 * The append-only audit trail of moderation actions: who acted, what they
 * did, on which target, optionally prompted by which flag, with an optional
 * note, and when. One row per action so the history is complete and immutable
 * — a `hide` then a later `restore` are two rows, never an overwrite (content
 * state lives on the content row, the decision history lives here).
 *
 * The target mirrors the `flags` exclusive arc: exactly one of `listingId`,
 * `claimId`, `incidentId` is set, enforced by the
 * `moderation_actions_one_target` CHECK. Each is a real FK with
 * `onDelete: cascade`, so an action can never dangle — though content is
 * soft-moderated rather than deleted, so cascade is a safety net, not the
 * normal path.
 *
 * `flagId` records the flag that prompted the action, `ON DELETE SET NULL` so
 * the audit record outlives the triage item. Nullable because an action may
 * be taken without a prompting flag (e.g. a `restore`).
 *
 * `actorId` is NOT NULL: every action is attributable to a moderator/admin.
 */
export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: id(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: moderationAction("action").notNull(),
    listingId: text("listing_id").references(() => listings.id, { onDelete: "cascade" }),
    claimId: text("claim_id").references(() => claims.id, { onDelete: "cascade" }),
    incidentId: text("incident_id").references(() => incidents.id, { onDelete: "cascade" }),
    flagId: text("flag_id").references(() => flags.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "moderation_actions_one_target",
      sql`num_nonnulls(${table.listingId}, ${table.claimId}, ${table.incidentId}) = 1`
    ),
    index("moderation_actions_listing_idx").on(table.listingId),
    index("moderation_actions_claim_idx").on(table.claimId),
    index("moderation_actions_incident_idx").on(table.incidentId),
    index("moderation_actions_flag_idx").on(table.flagId),
    index("moderation_actions_actor_idx").on(table.actorId),
  ]
);

// ---------------------------------------------------------------------------
// Inferred types (export $inferSelect + $inferInsert for every table)
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;

export type ListingLink = typeof listingLinks.$inferSelect;
export type NewListingLink = typeof listingLinks.$inferInsert;

export type Claim = typeof claims.$inferSelect;
export type NewClaim = typeof claims.$inferInsert;

export type Attestation = typeof attestations.$inferSelect;
export type NewAttestation = typeof attestations.$inferInsert;

export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

export type Flag = typeof flags.$inferSelect;
export type NewFlag = typeof flags.$inferInsert;

export type ModerationActionRow = typeof moderationActions.$inferSelect;
export type NewModerationActionRow = typeof moderationActions.$inferInsert;

// ---------------------------------------------------------------------------
// Enum value tuples (for app-side validation / filter UIs without re-importing
// the pgEnum). These mirror the `pgEnum` declarations above.
// ---------------------------------------------------------------------------

export const userRoles = userRole.enumValues;
export const claimAttributes = claimAttribute.enumValues;
export const listingLinkKinds = listingLinkKind.enumValues;
export const attestationValues = attestationValue.enumValues;
export const incidentSeverities = incidentSeverity.enumValues;
export const flagStatuses = flagStatus.enumValues;
export const moderationStatuses = moderationStatus.enumValues;
export const moderationActionTypes = moderationAction.enumValues;

// ---------------------------------------------------------------------------
// Enum value types (string-union of each enum's members, for typed app-side
// use — e.g. exhaustive label maps — without re-importing the pgEnum).
// ---------------------------------------------------------------------------

export type UserRole = (typeof userRoles)[number];
// Re-exported from the client-safe links module (single source of truth) so
// `~/db/schema` type consumers keep one import surface.
export type { LinkKind } from "~/listings/links";
// Re-exported from the client-safe taxonomy module (single source of truth)
// so `~/db/schema` type consumers keep one import surface.
export type { ClaimAttribute } from "~/listings/taxonomy";
export type AttestationValue = (typeof attestationValues)[number];
export type IncidentSeverity = (typeof incidentSeverities)[number];
export type FlagStatus = (typeof flagStatuses)[number];
export type ModerationStatus = (typeof moderationStatuses)[number];
export type ModerationActionType = (typeof moderationActionTypes)[number];
