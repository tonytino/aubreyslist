import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb } from "~/db/client";
import { type User, users } from "~/db/schema";
import { getEnv } from "~/env";

/**
 * Preview-only dev-login primitive (AUB-138), server-only.
 *
 * Google OAuth cannot work on Vercel per-deployment preview URLs: the redirect
 * URI is exact-match (no wildcards) and the callback is derived from the request
 * origin, which changes every push. This module backs a **prod-inert,
 * double-gated** endpoint that mints a session cookie WITHOUT Google, reusing
 * the SAME sealed-cookie primitive the OAuth callback (and the e2e `Seeder`)
 * uses — so a tester can sign in on any preview.
 *
 * Two independent gates, both required:
 *   1. {@link isPreviewLoginEnabled} — the runtime is an explicitly-allowed
 *      Vercel env (`preview` or `development`, fail-closed) AND a
 *      `PREVIEW_LOGIN_SECRET` is provisioned. This makes the endpoint 404 in
 *      production (and on any unrecognized/unset `VERCEL_ENV`) even if the
 *      secret ever leaked into Production scope.
 *   2. {@link verifyPreviewSecret} — a constant-time match of the caller's
 *      secret against `PREVIEW_LOGIN_SECRET`.
 *
 * **It can ONLY ever sign in as a preview-namespaced account.** Preview DBs are
 * Neon branches of production and therefore contain real admins; to make it
 * impossible to impersonate one, {@link resolvePreviewUser} REFUSES any email
 * that resolves to a row whose `google_sub` is not `preview:`-prefixed (a real
 * OAuth account). It only ever creates/reuses `preview:<email>` rows, whose role
 * is the DB default `user`.
 *
 * This module imports `db` + `getEnv` and must stay server-only — never import
 * it from a client component (no client-bundle leak, AGENTS.md Hard Rules).
 */

/** Default identity minted for the preview tester when no `?email=` is given. */
const DEFAULT_PREVIEW_EMAIL = "preview-tester@aubreyslist.test";
const DEFAULT_PREVIEW_NAME = "Preview Tester";
/** Synthetic `google_sub` namespace for dev-login accounts (never a real sub). */
const PREVIEW_SUB_PREFIX = "preview:";

/**
 * Whether the preview dev-login endpoint is active. Gate 1 of the double-gate,
 * **fail-closed**: it enables ONLY when `VERCEL_ENV` is an explicitly allowed
 * value (`preview` or `development`) AND `PREVIEW_LOGIN_SECRET` is provisioned.
 * Any other `VERCEL_ENV` — `production`, unset, or an unrecognized value — keeps
 * the endpoint disabled (404), so it never fails open. Evaluated per-request via
 * `getEnv()` — never at module load.
 *
 * For LOCAL dev-login, set `VERCEL_ENV=development` in `.env`; otherwise use real
 * Google on `http://localhost:3000` (its callback is registered).
 */
export function isPreviewLoginEnabled(): boolean {
  const env = getEnv();
  const envAllowed = env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development";
  return envAllowed && Boolean(env.PREVIEW_LOGIN_SECRET && env.PREVIEW_LOGIN_SECRET.length > 0);
}

/**
 * Constant-time check of a caller-supplied secret against `PREVIEW_LOGIN_SECRET`.
 * Gate 2 of the double-gate. Returns false when the endpoint is disabled, when
 * the candidate is missing, or on any mismatch.
 *
 * The comparison uses `node:crypto` `timingSafeEqual`, which requires
 * equal-length buffers, so we guard the length first (an unavoidable early-out —
 * length leakage alone does not meaningfully help an attacker against a ≥32-char
 * random secret) and otherwise compare the full byte content in constant time.
 */
export function verifyPreviewSecret(candidate: string | undefined): boolean {
  if (!isPreviewLoginEnabled()) {
    return false;
  }
  const expected = getEnv().PREVIEW_LOGIN_SECRET;
  if (!expected || !candidate) {
    return false;
  }

  const expectedBytes = Buffer.from(expected, "utf8");
  const candidateBytes = Buffer.from(candidate, "utf8");
  if (expectedBytes.length !== candidateBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, candidateBytes);
}

/**
 * Resolve the preview tester's `users` row, creating it on first use. Identity
 * anchors on a synthetic `google_sub` of `preview:<email>` so it can never
 * collide with a real Google subject.
 *
 * **Privilege-escalation defense (critical).** Preview DBs are Neon branches of
 * production, so they contain real admin/OAuth accounts. We look the email up
 * and:
 *   - existing row with a `preview:`-prefixed `google_sub` → reuse it (ours);
 *   - existing row that is NOT `preview:`-prefixed (a real/OAuth account) →
 *     REFUSE with `HTTPException(403)`, minting no cookie and inserting nothing.
 *     This makes `?email=<admin@real>` impossible to abuse into an admin session;
 *   - no row at all (`users.email` is unique, so no preview- or real-row owns it)
 *     → insert the preview user (role omitted → DB default `user`, ADR-010).
 *
 * A minted session can never elevate anyway — role is always re-read from the DB
 * by `getCurrentUser()` — but refusing real rows means dev-login can only ever
 * sign in as a `preview:`-namespaced `user`.
 *
 * @param email Optional override for the tester's email (from `?email=`).
 * @throws {HTTPException} 403 when the email resolves to a non-preview account.
 */
export async function resolvePreviewUser(email?: string): Promise<User> {
  const db = getDb();
  const normalizedEmail = email?.trim() || DEFAULT_PREVIEW_EMAIL;

  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });
  if (existing) {
    if (!existing.googleSub.startsWith(PREVIEW_SUB_PREFIX)) {
      // A real/OAuth account owns this email — refuse to impersonate it.
      throw new HTTPException(403, {
        message: "Preview dev-login can only sign in as preview-namespaced accounts.",
      });
    }
    return existing;
  }

  const [created] = await db
    .insert(users)
    .values({
      googleSub: `${PREVIEW_SUB_PREFIX}${normalizedEmail}`,
      email: normalizedEmail,
      name: DEFAULT_PREVIEW_NAME,
      // role omitted on purpose → DB default `user` (ADR-010).
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create preview tester user row");
  }
  return created;
}
