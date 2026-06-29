import { neon } from "@neondatabase/serverless";
import type { BrowserContext } from "@playwright/test";
import { sql } from "drizzle-orm";
import { type NeonHttpDatabase, drizzle } from "drizzle-orm/neon-http";
import * as schema from "~/db/schema";
import type { AttestationValue, ClaimAttribute } from "~/db/schema";
import { SESSION_COOKIE_NAME, sealSessionPayload } from "~/server/auth/session";
import type { IntakeMode } from "~/server/settings";

/**
 * Authenticated + DB-seeded E2E fixtures (issue #45).
 *
 * The repo ships NO `sessions` table — a session is a sealed, server-signed
 * cookie (ADR-006, `app/server/auth/session.ts`). So an E2E spec can establish
 * an authenticated session WITHOUT driving the real Google OAuth round-trip
 * (off-site, env-dependent) by reusing the SAME primitive the OAuth callback
 * uses: seed a `users` row, mint a cookie with the repo's own
 * {@link sealSessionPayload}, and hand it to the browser context. The dev server
 * then unseals + re-reads the live row via `getCurrentUser` exactly as in
 * production. This is the existing mechanism, not a new bypass endpoint — the
 * cookie carries only a user id and the authoritative row (incl. role) is always
 * re-read server-side.
 *
 * GATING (must never break a DB-less run): both writing the cookie AND seeding
 * need `DATABASE_URL` + `SESSION_SECRET`. With either absent — the default for
 * `pnpm preflight`/`pnpm build` and a CI run lacking `CI_E2E_DATABASE_URL` — the
 * specs that consume these fixtures `test.skip(...)` rather than fail (mirrors
 * the integration suite's `describe.skipIf`, see docs/agents/testing.md).
 *
 * IDEMPOTENCY: the CI Neon branch is PERSISTENT (state accrues across runs, see
 * docs/agents/testing.md). Every fixture is keyed on a unique per-run token so
 * repeated/concurrent runs never collide on a unique constraint
 * (`users.email`/`users.google_sub`, `listings.place_id`, …), and {@link Seeder}
 * tracks every top-level row it creates so {@link Seeder.cleanup} removes them
 * all (deleting a listing cascades to its claims/incidents/attestations).
 *
 * ENV ACCESS: reading `process.env` here is the sanctioned test-config exception
 * (AGENTS.md Hard Rules; `playwright.config.ts` already reads `process.env.CI`).
 * App code still goes through `app/env.ts` — these are test-only knobs.
 */

/** The CI E2E database connection string, if configured. */
const DATABASE_URL = process.env.DATABASE_URL;
/** The session signing secret, mirrored from the running dev server's env. */
const SESSION_SECRET = process.env.SESSION_SECRET;

/**
 * Whether the authenticated/DB-touching E2E fixtures can run: both a database
 * and the session secret must be present. Specs gate on this with `test.skip`.
 */
export const E2E_DB_READY: boolean =
  typeof DATABASE_URL === "string" &&
  DATABASE_URL.length > 0 &&
  typeof SESSION_SECRET === "string" &&
  SESSION_SECRET.length > 0;

/** A unique token per spec file invocation, suffixed onto every fixture value. */
export function uniqueToken(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

type Db = NeonHttpDatabase<typeof schema>;

/**
 * A small seed + teardown harness, one per spec. Construct it in `beforeEach`,
 * seed what the test needs, and call {@link cleanup} in `afterEach`. Tracks the
 * listing + user ids it creates so cleanup is exhaustive even if a test throws.
 */
export class Seeder {
  readonly db: Db;
  private readonly listingIds = new Set<string>();
  private readonly userIds = new Set<string>();
  private readonly settingKeys = new Set<string>();

  constructor() {
    if (!E2E_DB_READY) {
      throw new Error(
        "Seeder requires DATABASE_URL and SESSION_SECRET — gate the spec on E2E_DB_READY."
      );
    }
    // biome-ignore lint/style/noNonNullAssertion: guarded by E2E_DB_READY above.
    this.db = drizzle(neon(DATABASE_URL!), { schema });
  }

  /** Insert a user (role defaults to `user`) keyed on a unique token. */
  async createUser(token: string): Promise<schema.User> {
    const [user] = await this.db
      .insert(schema.users)
      .values({
        googleSub: `${token}-sub`,
        email: `${token}@example.test`,
        name: `E2E ${token}`,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert returns one row.
    this.userIds.add(user!.id);
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert returns one row.
    return user!;
  }

  /**
   * Insert a manual-entry listing (`place_id` NULL) keyed on a unique token. The
   * name is what specs assert on, so it carries the token to scope assertions.
   */
  async createListing(
    token: string,
    overrides: Partial<schema.NewListing> = {}
  ): Promise<schema.Listing> {
    const [listing] = await this.db
      .insert(schema.listings)
      .values({
        placeId: null,
        name: `${token} Diner`,
        address: "1 Test St, Denver, CO",
        lat: 39.7392,
        lng: -104.9903,
        mapsUrl: "https://maps.example.test/x",
        ...overrides,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert returns one row.
    this.listingIds.add(listing!.id);
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert returns one row.
    return listing!;
  }

  /** Insert a claim on a listing for the given taxonomy attribute. */
  async createClaim(listingId: string, attribute: ClaimAttribute): Promise<schema.Claim> {
    const [claim] = await this.db
      .insert(schema.claims)
      .values({ listingId, attribute })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: a single-row insert returns one row.
    return claim!;
  }

  /**
   * Cast a confirm/dispute attestation on a claim, by a freshly-created user, and
   * bump the claim's `lastConfirmedAt` to `now` for a `confirm` so the headline
   * cue reads fresh (mirrors the production recompute). Returns the voter so the
   * caller can reuse them. Each call makes a new user — one vote per user/claim.
   */
  async attest(claimId: string, value: AttestationValue, voterToken: string): Promise<schema.User> {
    const voter = await this.createUser(voterToken);
    await this.db.insert(schema.attestations).values({ claimId, userId: voter.id, value });
    if (value === "confirm") {
      await this.db
        .update(schema.claims)
        .set({ lastConfirmedAt: new Date() })
        .where(sql`${schema.claims.id} = ${claimId}`);
    }
    return voter;
  }

  /**
   * Force the active intake mode (default is `places`, which needs a Places API
   * key). Manual mode keeps the add-listing flow deterministic and key-free. The
   * key is tracked so {@link cleanup} restores the row to its absence.
   */
  async setIntakeMode(mode: IntakeMode): Promise<void> {
    this.settingKeys.add("intake_mode");
    await this.db
      .insert(schema.appSettings)
      .values({ key: "intake_mode", value: mode })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: mode, updatedAt: new Date() },
      });
  }

  /**
   * Mint a sealed session cookie for `userId` and add it to the browser context,
   * so the dev server sees an authenticated session — reusing the repo's own
   * {@link sealSessionPayload} (the exact seal the OAuth callback writes).
   */
  async signIn(context: BrowserContext, userId: string, baseURL: string): Promise<void> {
    const sealed = await sealSessionPayload({
      userId,
      issuedAt: Math.floor(Date.now() / 1000),
    });
    const url = new URL(baseURL);
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: sealed,
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }

  /**
   * Delete every listing whose name equals `name` (cascading to its children).
   * Used to clean up a listing the APP — not the seeder — inserted, e.g. one
   * created through the add-listing form, so the persistent CI branch stays tidy.
   */
  async deleteListingsByName(name: string): Promise<void> {
    await this.db.delete(schema.listings).where(sql`${schema.listings.name} = ${name}`);
  }

  /**
   * Delete everything created by this seeder. Listings cascade to their claims,
   * attestations, and incidents; users are deleted separately (not children of a
   * listing) but their attestations/incidents already cascaded with the listing.
   * Settings rows are deleted so the persistent branch returns to its defaults.
   */
  async cleanup(): Promise<void> {
    for (const id of this.listingIds) {
      await this.db.delete(schema.listings).where(sql`${schema.listings.id} = ${id}`);
    }
    for (const id of this.userIds) {
      await this.db.delete(schema.users).where(sql`${schema.users.id} = ${id}`);
    }
    for (const key of this.settingKeys) {
      await this.db.delete(schema.appSettings).where(sql`${schema.appSettings.key} = ${key}`);
    }
    this.listingIds.clear();
    this.userIds.clear();
    this.settingKeys.clear();
  }
}
