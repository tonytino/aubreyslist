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
 * The fixed, curated GF attribute taxonomy (domain.md). NOT user-extensible in
 * v1. Each value maps 1:1 to a taxonomy item; keep this in lockstep with the
 * taxonomy list, the filter UI, and any seed data when it changes.
 */
export const claimAttribute = pgEnum("claim_attribute", [
  "celiac_safe_vs_gluten_friendly",
  "dedicated_fryer",
  "cross_contamination_protocol",
  "dedicated_gf_menu",
  "off_menu_gf_on_request",
  "staff_knowledge",
  "gf_substitutes",
]);

/** A single user's vote on a claim — confirm or dispute. */
export const attestationValue = pgEnum("attestation_value", ["confirm", "dispute"]);

/** Optional severity of a reported "got glutened" reaction. */
export const incidentSeverity = pgEnum("incident_severity", ["mild", "moderate", "severe"]);

/** Moderation flag lifecycle status. */
export const flagStatus = pgEnum("flag_status", ["open", "reviewing", "resolved", "dismissed"]);

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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
 * The target is modeled as an EXCLUSIVE ARC: exactly one of `listingId`,
 * `claimId`, `incidentId` is set, enforced by the `flags_one_target` CHECK.
 * Each is a real FK with `onDelete: cascade`, so a flag can never dangle or
 * point at the wrong table, and deleting content auto-removes its flags — no
 * orphan cleanup or app-side referential validation needed. Trade-off: adding a
 * new flaggable entity type later means a migration (new nullable FK column +
 * extend the CHECK), not just an enum value.
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

// ---------------------------------------------------------------------------
// Inferred types (export $inferSelect + $inferInsert for every table)
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;

export type Claim = typeof claims.$inferSelect;
export type NewClaim = typeof claims.$inferInsert;

export type Attestation = typeof attestations.$inferSelect;
export type NewAttestation = typeof attestations.$inferInsert;

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

export type Flag = typeof flags.$inferSelect;
export type NewFlag = typeof flags.$inferInsert;

// ---------------------------------------------------------------------------
// Enum value tuples (for app-side validation / filter UIs without re-importing
// the pgEnum). These mirror the `pgEnum` declarations above.
// ---------------------------------------------------------------------------

export const userRoles = userRole.enumValues;
export const claimAttributes = claimAttribute.enumValues;
export const attestationValues = attestationValue.enumValues;
export const incidentSeverities = incidentSeverity.enumValues;
export const flagStatuses = flagStatus.enumValues;
