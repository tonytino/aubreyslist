import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { type NeonHttpDatabase, drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "~/db/schema";
import { listIncidents } from "~/server/incidents";
import { findRecentIncident, parseCalendarDay } from "~/trust/incident-recency";

/**
 * Incident `occurredOn` date round-trip integration test (issue #45 follow-up).
 *
 * GROUND TRUTH FOR A REAL BUG: the recent-incident banner on the listing-detail
 * page is derived by `findRecentIncident(incidents, now)` →
 * `isRecentIncident` → `parseCalendarDay(occurredOn)`, which requires a STRICT
 * `YYYY-MM-DD` string. `incidents.occurred_on` is a Postgres `date` column
 * declared as `date("occurred_on")` (Drizzle `PgDateString`, which passes the
 * driver value through verbatim). The Neon HTTP driver applies a `pg-types`
 * parser to the `date` OID (1082) that returns a JS **`Date`**, not the
 * `"YYYY-MM-DD"` text — so without a normalization boundary, `occurredOn` reaches
 * the recency logic as a `Date`, `parseCalendarDay` returns null, and the
 * banner NEVER renders (the live E2E flagged this; unit tests miss it because
 * they hand-build `"YYYY-MM-DD"` data and never round-trip through the driver).
 *
 * This test inserts an incident via the real schema and reads it back through the
 * real `listIncidents` query, asserting:
 *   (a) the returned `occurredOn` is EXACTLY the `YYYY-MM-DD` string we wrote
 *       (`typeof` string + strict regex + equality), and
 *   (b) `findRecentIncident([row], now)` returns it.
 * It FAILS if the driver mangles the date, and stands as a regression guard.
 *
 * GATING + IDEMPOTENCY mirror `schema-constraints.test.ts`: runs only when
 * `TEST_DATABASE_URL` is set (CI's `CI_E2E_DATABASE_URL`), uses a unique per-run
 * token so the persistent CI Neon branch never collides, and cleans up after
 * itself (deleting the listing cascades to its incidents; the user is deleted
 * separately).
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const hasDb = typeof TEST_DATABASE_URL === "string" && TEST_DATABASE_URL.length > 0;

const run = `it45-${crypto.randomUUID()}`;

describe.skipIf(!hasDb)("incident occurredOn round-trip (real Postgres)", () => {
  let db: NeonHttpDatabase<typeof schema>;
  let listingId: string;
  let userId: string;

  beforeAll(async () => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by `hasDb` / skipIf.
    db = drizzle(neon(TEST_DATABASE_URL!), { schema });
    await migrate(db, { migrationsFolder: "db/migrations" });

    const [user] = await db
      .insert(schema.users)
      .values({
        googleSub: `${run}-sub`,
        email: `${run}@example.test`,
        name: "Incident Date Bot",
      })
      .returning({ id: schema.users.id });
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert returns one row.
    userId = user!.id;

    const [listing] = await db
      .insert(schema.listings)
      .values({
        placeId: null,
        name: `${run} Diner`,
        address: "1 Test St",
        lat: 0,
        lng: 0,
        mapsUrl: "https://maps.example.test/x",
      })
      .returning({ id: schema.listings.id });
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert returns one row.
    listingId = listing!.id;
  });

  afterAll(async () => {
    if (!db) return;
    if (listingId) {
      await db.delete(schema.listings).where(sql`${schema.listings.id} = ${listingId}`);
    }
    if (userId) {
      await db.delete(schema.users).where(sql`${schema.users.id} = ${userId}`);
    }
  });

  it("listIncidents returns occurredOn as a canonical YYYY-MM-DD string", async () => {
    const occurredOn = "2026-06-28";
    await db.insert(schema.incidents).values({ listingId, userId, occurredOn });

    const rows = await listIncidents({ listingId });
    const row = rows.find((r) => r.userId === userId);
    expect(row).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above.
    const value = row!.occurredOn;

    // (a) It is the exact YYYY-MM-DD string we wrote — not a Date, not an ISO
    // timestamp. This is the contract `parseCalendarDay` depends on.
    expect(typeof value).toBe("string");
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(value).toBe(occurredOn);

    // (b) The recency derivation that drives the banner sees it as recent.
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above.
    const recent = findRecentIncident([row!], new Date(`${occurredOn}T12:00:00Z`));
    expect(recent).not.toBeNull();
    expect(recent?.occurredOn).toBe(occurredOn);

    // Sanity: the same value parses as a real calendar day (would be null if the
    // driver had handed back a Date or timestamp).
    expect(parseCalendarDay(value)).not.toBeNull();
  });

  it("the live report→read→flag path: a yesterday-dated incident flags the recent-incident banner", async () => {
    // Mirror the E2E report-incident flow's data path against real Postgres,
    // independent of the browser: write a YESTERDAY-dated incident (the same
    // YYYY-MM-DD the form submits — strictly past, well inside the 90-day window),
    // read it back through the REAL `listIncidents`, then assert the SAME
    // `findRecentIncident(incidents, now)` the client banner uses — evaluated at
    // the REAL current time — flags it. This proves the recent-incident banner's
    // trust-critical signal end-to-end at the data layer, not just in the E2E.
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // A dedicated listing so this assertion is scoped to exactly one incident.
    const [listing] = await db
      .insert(schema.listings)
      .values({
        placeId: null,
        name: `${run} Live Diner`,
        address: "2 Test St",
        lat: 0,
        lng: 0,
        mapsUrl: "https://maps.example.test/y",
      })
      .returning({ id: schema.listings.id });
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert returns one row.
    const liveListingId = listing!.id;

    await db.insert(schema.incidents).values({
      listingId: liveListingId,
      userId,
      occurredOn: yesterday,
    });

    const incidents = await listIncidents({ listingId: liveListingId });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.occurredOn).toBe(yesterday);

    // The exact derivation the client banner runs, at the real current time.
    const recent = findRecentIncident(incidents, now);
    expect(recent).not.toBeNull();
    expect(recent?.occurredOn).toBe(yesterday);

    // Scoped cleanup (cascades the incident); the shared user is removed in afterAll.
    await db.delete(schema.listings).where(sql`${schema.listings.id} = ${liveListingId}`);
  });
});
