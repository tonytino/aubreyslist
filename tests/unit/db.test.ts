import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, expectTypeOf, it } from "vitest";
// Import through the documented `~/db/*` alias (see docs/agents/database.md) so
// a broken alias or path regression fails here rather than silently in a
// scaffolded project.
import { getDb } from "~/db/client";
import * as schema from "~/db/schema";

describe("db module wiring", () => {
  it("exposes getDb as a lazy factory (importing requires no DATABASE_URL)", () => {
    // getDb is memoized/lazy — importing the module must not construct the
    // client or read env, so this is safe without a live database.
    expect(typeof getDb).toBe("function");
  });

  it("resolves the schema module via the ~/db alias", () => {
    expect(schema).toBeTypeOf("object");
  });
});

describe("core schema — tables", () => {
  it("exports every domain table", () => {
    expect(schema.users).toBeDefined();
    expect(schema.listings).toBeDefined();
    expect(schema.claims).toBeDefined();
    expect(schema.attestations).toBeDefined();
    expect(schema.incidents).toBeDefined();
    expect(schema.appSettings).toBeDefined();
    expect(schema.flags).toBeDefined();
  });

  it("maps tables to the expected snake_case names", () => {
    expect(getTableConfig(schema.users).name).toBe("users");
    expect(getTableConfig(schema.listings).name).toBe("listings");
    expect(getTableConfig(schema.claims).name).toBe("claims");
    expect(getTableConfig(schema.attestations).name).toBe("attestations");
    expect(getTableConfig(schema.incidents).name).toBe("incidents");
    expect(getTableConfig(schema.appSettings).name).toBe("app_settings");
    expect(getTableConfig(schema.flags).name).toBe("flags");
  });
});

describe("core schema — enums", () => {
  it("declares the role enum (ADR-010), defaulting to user", () => {
    expect(schema.userRoles).toEqual(["admin", "moderator", "user"]);
  });

  it("declares the FIXED 7-item GF attribute taxonomy in order", () => {
    expect(schema.claimAttributes).toEqual([
      "celiac_safe_vs_gluten_friendly",
      "dedicated_fryer",
      "cross_contamination_protocol",
      "dedicated_gf_menu",
      "off_menu_gf_on_request",
      "staff_knowledge",
      "gf_substitutes",
    ]);
    // Guard against accidental drift in the taxonomy size.
    expect(schema.claimAttributes).toHaveLength(7);
  });

  it("declares attestation values as confirm/dispute", () => {
    expect(schema.attestationValues).toEqual(["confirm", "dispute"]);
  });

  it("declares incident severity levels", () => {
    expect(schema.incidentSeverities).toEqual(["mild", "moderate", "severe"]);
  });

  it("declares flag statuses", () => {
    expect(schema.flagStatuses).toEqual(["open", "reviewing", "resolved", "dismissed"]);
  });
});

/** Helper: collect declared UNIQUE constraints (columns) for a table. */
function uniqueColumnSets(table: Parameters<typeof getTableConfig>[0]): string[][] {
  const config = getTableConfig(table);
  const sets: string[][] = [];
  // Column-level `.unique()` surfaces as a unique constraint on a single column.
  for (const col of config.columns) {
    if (col.isUnique) {
      sets.push([col.name]);
    }
  }
  // Table-level `unique(...).on(...)` surfaces in `uniqueConstraints`.
  for (const constraint of config.uniqueConstraints) {
    sets.push(constraint.columns.map((c) => c.name));
  }
  return sets;
}

describe("core schema — constraints", () => {
  it("enforces a unique Google Place ID on listings (dedup key)", () => {
    expect(uniqueColumnSets(schema.listings)).toContainEqual(["place_id"]);
  });

  it("keeps place_id nullable so manual entries (no Place ID) coexist", () => {
    const placeId = getTableConfig(schema.listings).columns.find((c) => c.name === "place_id");
    expect(placeId).toBeDefined();
    expect(placeId?.notNull).toBe(false);
  });

  it("enforces unique google_sub and email on users", () => {
    const sets = uniqueColumnSets(schema.users);
    expect(sets).toContainEqual(["google_sub"]);
    expect(sets).toContainEqual(["email"]);
  });

  it("enforces one claim per (listing, attribute)", () => {
    expect(uniqueColumnSets(schema.claims)).toContainEqual(["listing_id", "attribute"]);
  });

  it("enforces one attestation per (claim, user) — one vote per user per claim", () => {
    expect(uniqueColumnSets(schema.attestations)).toContainEqual(["claim_id", "user_id"]);
  });

  it("requires occurred_on on incidents and allows severity/note to be null", () => {
    const cols = getTableConfig(schema.incidents).columns;
    const byName = (name: string) => cols.find((c) => c.name === name);
    expect(byName("occurred_on")?.notNull).toBe(true);
    expect(byName("severity")?.notNull).toBe(false);
    expect(byName("note")?.notNull).toBe(false);
  });

  it("declares foreign keys on the relational tables", () => {
    expect(getTableConfig(schema.claims).foreignKeys.length).toBeGreaterThan(0);
    expect(getTableConfig(schema.attestations).foreignKeys.length).toBe(2);
    expect(getTableConfig(schema.incidents).foreignKeys.length).toBe(2);
    // flags use an exclusive arc: 3 nullable target FKs + reporter.
    expect(getTableConfig(schema.flags).foreignKeys.length).toBe(4);
  });

  it("models flag targets as an exclusive arc (nullable target FKs + required reporter)", () => {
    const cols = getTableConfig(schema.flags).columns;
    const byName = (name: string) => cols.find((c) => c.name === name);
    expect(byName("listing_id")?.notNull).toBe(false);
    expect(byName("claim_id")?.notNull).toBe(false);
    expect(byName("incident_id")?.notNull).toBe(false);
    expect(byName("reporter_id")?.notNull).toBe(true);
  });

  it("uses key as the primary key for app_settings", () => {
    const key = getTableConfig(schema.appSettings).columns.find((c) => c.name === "key");
    expect(key?.primary).toBe(true);
  });
});

describe("core schema — inferred types", () => {
  it("infers select/insert row shapes for every table", () => {
    // Compile-time assertions: a regression in the inferred types fails `tsc`.
    expectTypeOf<schema.User>().toHaveProperty("role");
    expectTypeOf<schema.NewUser>().toHaveProperty("googleSub");
    expectTypeOf<schema.Listing>().toHaveProperty("placeId");
    expectTypeOf<schema.NewListing>().toHaveProperty("name");
    expectTypeOf<schema.Claim>().toHaveProperty("attribute");
    expectTypeOf<schema.NewClaim>().toHaveProperty("listingId");
    expectTypeOf<schema.Attestation>().toHaveProperty("value");
    expectTypeOf<schema.NewAttestation>().toHaveProperty("claimId");
    expectTypeOf<schema.Incident>().toHaveProperty("occurredOn");
    expectTypeOf<schema.NewIncident>().toHaveProperty("listingId");
    expectTypeOf<schema.AppSetting>().toHaveProperty("key");
    expectTypeOf<schema.NewAppSetting>().toHaveProperty("value");
    expectTypeOf<schema.Flag>().toHaveProperty("status");
    expectTypeOf<schema.Flag>().toHaveProperty("listingId");
    expectTypeOf<schema.NewFlag>().toHaveProperty("reason");
    // role is the constrained union from the enum, not a bare string.
    expectTypeOf<schema.User["role"]>().toEqualTypeOf<"admin" | "moderator" | "user">();
    // severity is the constrained enum union (nullable), not a bare number.
    expectTypeOf<schema.Incident["severity"]>().toEqualTypeOf<
      "mild" | "moderate" | "severe" | null
    >();
  });
});
