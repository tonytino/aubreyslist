import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { type NeonHttpDatabase, drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "~/db/schema";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * CANONICAL TRUST-MODEL INVARIANT SUITE — DB-enforced half (issues #178/#185)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * DO NOT WEAKEN. The DB-backed companion to `app/trust/trust-model.invariant.test.ts`
 * (ADR-007) and `app/server/listings/intake-dedup.invariant.test.ts` (ADR-008).
 * Some trust guarantees are enforced by the DATABASE, not just app logic, and
 * must be pinned against a real Postgres so a migration that declared but failed
 * to apply a constraint can't ship green:
 *
 *   - INVARIANT 3 — one attestation per user per claim (ADR-007: "One vote per
 *     user per claim … Enforce server-side", domain.md). The server upsert path
 *     relies on the `attestations_claim_user_unique` UNIQUE(claim_id, user_id)
 *     constraint to make a second vote UPDATE the existing row, never stack a
 *     duplicate. Here we prove the DB rejects a raw duplicate INSERT.
 *   - INVARIANT 5 — Place ID is the dedup key (ADR-008). `UNIQUE(place_id)` makes
 *     two intakes for the same Place ID resolve to ONE listing at the DB level,
 *     while manual entries (place_id NULL) coexist (Postgres treats NULLs as
 *     distinct) and are deduped in app logic instead.
 *
 * These overlap intentionally with `tests/integration/schema-constraints.test.ts`
 * (issue #92): that file pins the constraints as schema integrity; THIS file
 * frames the same two as the canonical, named TRUST invariants so the guarantee
 * is discoverable from the trust-invariant suite and can't be quietly dropped.
 *
 * GATING — must never break CI without a database. Runs ONLY when
 * `TEST_DATABASE_URL` is set (a Neon HTTP URL); otherwise `describe.skipIf`
 * reports SKIPPED, never failed, so `pnpm preflight` / the offline `Unit tests`
 * step stay green. Point it at the throwaway CI Neon branch to activate.
 *
 * IDEMPOTENCY — the CI Neon branch is PERSISTENT (state accrues across runs).
 * Every fixture uses a unique per-run token and `afterAll` deletes everything
 * created (deleting a listing cascades to its claims/attestations/incidents).
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const hasDb = typeof TEST_DATABASE_URL === "string" && TEST_DATABASE_URL.length > 0;

// Unique per-run token so fixtures never collide on the persistent CI branch.
const run = `it185-${crypto.randomUUID()}`;

describe.skipIf(!hasDb)("trust-model invariants (real Postgres)", () => {
  let db: NeonHttpDatabase<typeof schema>;
  const listingIds = new Set<string>();
  let userId: string;
  let secondUserId: string;

  beforeAll(async () => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by `hasDb` / skipIf.
    const client = neon(TEST_DATABASE_URL!);
    db = drizzle(client, { schema });

    // Apply migrations so the invariants are asserted against the migration
    // output (idempotent via Drizzle's journal — safe on the already-migrated branch).
    await migrate(db, { migrationsFolder: "db/migrations" });

    const [user] = await db
      .insert(schema.users)
      .values({
        googleSub: `${run}-sub`,
        email: `${run}@example.test`,
        name: "Trust Invariant Bot",
      })
      .returning({ id: schema.users.id });
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert always returns one row.
    userId = user!.id;

    const [second] = await db
      .insert(schema.users)
      .values({
        googleSub: `${run}-sub-2`,
        email: `${run}-2@example.test`,
        name: "Trust Invariant Bot 2",
      })
      .returning({ id: schema.users.id });
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert always returns one row.
    secondUserId = second!.id;
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of listingIds) {
      await db.delete(schema.listings).where(sql`${schema.listings.id} = ${id}`);
    }
    for (const id of [userId, secondUserId]) {
      if (id) await db.delete(schema.users).where(sql`${schema.users.id} = ${id}`);
    }
  });

  /** Insert a listing (manual entry → place_id NULL unless given) and track it. */
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

  // ─────────────────────────────────────────────────────────────────────────
  // INVARIANT 3 — one attestation per user per claim (no ballot-stuffing).
  // ─────────────────────────────────────────────────────────────────────────

  it("INVARIANT 3 — rejects a SECOND attestation for the same (claim, user) — UNIQUE(claim_id, user_id)", async () => {
    const listingId = await makeListing();
    const claimId = await makeClaim(listingId);

    // First vote inserts fine.
    await db.insert(schema.attestations).values({ claimId, userId, value: "confirm" });

    // A raw second INSERT by the SAME user on the SAME claim must be rejected by
    // the DB — the constraint the server upsert (onConflictDoUpdate) relies on so
    // a re-vote UPDATES rather than stacks. A flip to "dispute" is still a dup.
    await expect(
      db.insert(schema.attestations).values({ claimId, userId, value: "dispute" })
    ).rejects.toThrow();
  });

  it("INVARIANT 3 — allows DIFFERENT users to each attest the same claim (one vote EACH)", async () => {
    const listingId = await makeListing();
    const claimId = await makeClaim(listingId);

    // One vote per user is the rule — two distinct users each casting one vote on
    // the same claim is allowed (the constraint is per-user, not per-claim).
    await db.insert(schema.attestations).values({ claimId, userId, value: "confirm" });
    await expect(
      db.insert(schema.attestations).values({ claimId, userId: secondUserId, value: "dispute" })
    ).resolves.toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // INVARIANT 5 — Place ID is the dedup key (same place → one listing).
  // ─────────────────────────────────────────────────────────────────────────

  it("INVARIANT 5 — rejects a duplicate place_id but lets manual (NULL) entries coexist — UNIQUE(place_id)", async () => {
    const placeId = `${run}-place`;
    await makeListing(placeId);

    // Same Place ID again → unique violation (one place, one listing).
    await expect(makeListing(placeId)).rejects.toThrow();

    // Manual entries (place_id NULL) coexist — Postgres treats NULLs as distinct;
    // their dedup is the app-level name+address safeguard (see the unit suite).
    await expect(makeListing(null)).resolves.toEqual(expect.any(String));
    await expect(makeListing(null)).resolves.toEqual(expect.any(String));
  });
});
