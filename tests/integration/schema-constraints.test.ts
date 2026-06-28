import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { type NeonHttpDatabase, drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "~/db/schema";

/**
 * DB-level schema-constraint integration tests (issue #92).
 *
 * The unit suite (`tests/unit/db.test.ts`) only asserts Drizzle `getTableConfig`
 * METADATA — it never touches a real database, so a migration that *declared*
 * but failed to *apply* a constraint would still pass. This suite exercises the
 * runtime integrity guarantees against a real Postgres: it applies the
 * migrations and then asserts the invariants actually fire.
 *
 * GATING — must never break CI without a database:
 * This suite runs ONLY when `TEST_DATABASE_URL` is set to a Postgres connection
 * string (a Neon HTTP URL). With no database configured (the default for
 * `pnpm preflight` and the `Unit tests` CI step), `describe.skipIf` reports the
 * suite as SKIPPED — never failed — so the suite stays green offline. Point
 * `TEST_DATABASE_URL` at the throwaway CI Neon branch (the same one behind the
 * `CI_E2E_DATABASE_URL` secret) to activate it.
 *
 * IDEMPOTENCY — the CI Neon branch is PERSISTENT (state accrues across runs, see
 * docs/agents/testing.md). Every fixture uses a unique per-run token so repeated
 * or concurrent runs never collide on a unique constraint, and `afterAll`
 * deletes everything this suite created (deleting the listing cascades to its
 * children).
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const hasDb = typeof TEST_DATABASE_URL === "string" && TEST_DATABASE_URL.length > 0;

// A unique token per run so fixtures never collide with prior runs on the
// persistent CI branch (users.email/google_sub, listings.place_id, ...).
const run = `it92-${crypto.randomUUID()}`;

describe.skipIf(!hasDb)("schema constraints (real Postgres)", () => {
  let db: NeonHttpDatabase<typeof schema>;
  // Track top-level rows we create so cleanup is exhaustive even if a test
  // throws mid-way. Deleting a listing cascades to claims/incidents/flags; the
  // user is deleted separately (it is not a child of the listing).
  const listingIds = new Set<string>();
  let userId: string;

  beforeAll(async () => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by `hasDb` / skipIf.
    const client = neon(TEST_DATABASE_URL!);
    db = drizzle(client, { schema });

    // Apply migrations so the suite asserts against the migration output (issue
    // #92), not an ad-hoc schema. `migrate` is idempotent via Drizzle's journal
    // table, so it is safe to run against the already-migrated CI branch.
    await migrate(db, { migrationsFolder: "db/migrations" });

    // One shared user (the reporter / attester) for the whole suite.
    const [user] = await db
      .insert(schema.users)
      .values({
        googleSub: `${run}-sub`,
        email: `${run}@example.test`,
        name: "Schema Constraint Bot",
      })
      .returning({ id: schema.users.id });
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert always returns one row.
    userId = user!.id;
  });

  afterAll(async () => {
    if (!db) return;
    // Cascade removes claims/incidents/flags hung off each listing.
    for (const id of listingIds) {
      await db.delete(schema.listings).where(sql`${schema.listings.id} = ${id}`);
    }
    if (userId) {
      await db.delete(schema.users).where(sql`${schema.users.id} = ${userId}`);
    }
  });

  /** Insert a fresh listing (manual entry: place_id NULL) and track it. */
  async function makeListing(placeId: string | null = null): Promise<string> {
    const [listing] = await db
      .insert(schema.listings)
      .values({
        placeId,
        name: `${run} Diner`,
        address: "1 Test St",
        lat: 0,
        lng: 0,
        mapsUrl: "https://maps.example.test/x",
      })
      .returning({ id: schema.listings.id });
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert always returns one row.
    listingIds.add(listing!.id);
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert always returns one row.
    return listing!.id;
  }

  async function makeClaim(listingId: string): Promise<string> {
    const [claim] = await db
      .insert(schema.claims)
      .values({ listingId, attribute: "dedicated_fryer" })
      .returning({ id: schema.claims.id });
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert always returns one row.
    return claim!.id;
  }

  it("rejects a second attestation for the same (claim, user) — UNIQUE(claim_id, user_id)", async () => {
    const listingId = await makeListing();
    const claimId = await makeClaim(listingId);

    await db.insert(schema.attestations).values({ claimId, userId, value: "confirm" });

    await expect(
      db.insert(schema.attestations).values({ claimId, userId, value: "dispute" })
    ).rejects.toThrow();
  });

  it("accepts a flag with exactly one target but rejects zero or two — flags_one_target CHECK", async () => {
    const listingId = await makeListing();
    const claimId = await makeClaim(listingId);

    // Exactly one target → OK.
    await expect(
      db.insert(schema.flags).values({
        listingId,
        reporterId: userId,
        reason: `${run} exactly-one`,
      })
    ).resolves.toBeDefined();

    // Zero targets → CHECK violation.
    await expect(
      db.insert(schema.flags).values({ reporterId: userId, reason: `${run} zero` })
    ).rejects.toThrow();

    // Two targets → CHECK violation.
    await expect(
      db.insert(schema.flags).values({
        listingId,
        claimId,
        reporterId: userId,
        reason: `${run} two`,
      })
    ).rejects.toThrow();
  });

  it("rejects a duplicate place_id but lets multiple NULL place_ids coexist — UNIQUE(place_id)", async () => {
    const placeId = `${run}-place`;
    await makeListing(placeId);

    // Same Place ID again → unique violation.
    await expect(makeListing(placeId)).rejects.toThrow();

    // Two NULL place_ids coexist (Postgres treats NULLs as distinct).
    await expect(makeListing(null)).resolves.toEqual(expect.any(String));
    await expect(makeListing(null)).resolves.toEqual(expect.any(String));
  });

  it("cascades a listing delete to its claims, incidents, and flags — onDelete: cascade", async () => {
    const listingId = await makeListing();
    const claimId = await makeClaim(listingId);
    await db.insert(schema.attestations).values({ claimId, userId, value: "confirm" });
    await db.insert(schema.incidents).values({ listingId, userId, occurredOn: "2026-01-01" });
    await db.insert(schema.flags).values({
      listingId,
      reporterId: userId,
      reason: `${run} cascade`,
    });

    const countWhere = async (
      table: typeof schema.claims | typeof schema.incidents | typeof schema.flags,
      column: "listing_id",
      value: string
    ) => {
      const rows = await db
        .select({ id: sql<string>`id` })
        .from(table)
        .where(sql`${sql.identifier(column)} = ${value}`);
      return rows.length;
    };

    // Sanity: children exist before the delete.
    expect(await countWhere(schema.claims, "listing_id", listingId)).toBeGreaterThan(0);
    expect(await countWhere(schema.incidents, "listing_id", listingId)).toBeGreaterThan(0);
    expect(await countWhere(schema.flags, "listing_id", listingId)).toBeGreaterThan(0);

    await db.delete(schema.listings).where(sql`${schema.listings.id} = ${listingId}`);
    listingIds.delete(listingId);

    // Children are gone via cascade.
    expect(await countWhere(schema.claims, "listing_id", listingId)).toBe(0);
    expect(await countWhere(schema.incidents, "listing_id", listingId)).toBe(0);
    expect(await countWhere(schema.flags, "listing_id", listingId)).toBe(0);
    // And the attestation under the (now-deleted) claim cascaded too.
    const attestations = await db
      .select({ id: schema.attestations.id })
      .from(schema.attestations)
      .where(sql`${schema.attestations.claimId} = ${claimId}`);
    expect(attestations.length).toBe(0);
  });
});
