import { seal, defaults as sealDefaults, unseal } from "iron-webcrypto";
import { z } from "zod";
import { getEnv } from "~/env";

/**
 * Stateless, server-signed session.
 *
 * ADR-006 deliberately ships **no `sessions` table** — the session is a sealed
 * (signed + encrypted) cookie. We use `iron-webcrypto` (the same primitive h3's
 * built-in `useSession` seals with) directly so the seal/unseal logic is a
 * single portable module usable from BOTH the Hono auth routes (which receive a
 * raw `Request`, not an ambient h3 event) and server functions. The cookie
 * holds only the user id; the full user row is always re-read from the DB by the
 * current-user accessor, so a stale/forged cookie can never elevate a session.
 */

/** Name of the session cookie. */
export const SESSION_COOKIE_NAME = "al_session";

/** Session lifetime in seconds (30 days). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Shape of the data we seal into the cookie. Keep this minimal. */
const sessionPayloadSchema = z.object({
  userId: z.string().min(1),
  // Unix seconds at which this session was issued; used for expiry.
  issuedAt: z.number().int().positive(),
});

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

/**
 * Read the session signing secret, throwing a clear error if it is unset.
 *
 * `SESSION_SECRET` stays declared `optional()` in `app/env.ts` (CI lacks it),
 * so we guard at the point of use: any auth flow that needs to sign or verify a
 * session fails loudly here rather than silently producing an unsigned cookie.
 */
function getSessionSecret(): string {
  const secret = getEnv().SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. It is required for signing sessions — see docs/setup/provisioning.md."
    );
  }
  return secret;
}

// iron-webcrypto types its `_Crypto` parameter with `Uint8Array` data params,
// while the DOM lib types the global `crypto.subtle` with `BufferSource`. The
// two are runtime-identical (Web Crypto); the gap is purely a TS lib variance
// quirk (ArrayBuffer vs SharedArrayBuffer). Narrow once here to the exact
// parameter type iron expects rather than scattering casts at each call site.
const ironCrypto = globalThis.crypto as unknown as Parameters<typeof seal>[0];

/** Seal a session payload into an opaque cookie value. */
export async function sealSessionPayload(payload: SessionPayload): Promise<string> {
  return seal(ironCrypto, payload, getSessionSecret(), sealDefaults);
}

/** Create a freshly-issued sealed session for a user id. */
export async function createSessionCookieValue(userId: string): Promise<string> {
  return sealSessionPayload({ userId, issuedAt: Math.floor(Date.now() / 1000) });
}

/**
 * Unseal + validate a sealed cookie value. Returns the payload, or `null` for
 * any failure (tampered, wrong secret, malformed, or expired). Never throws on
 * bad input — a missing/garbage cookie simply means "not signed in".
 */
export async function readSessionCookieValue(sealed: string): Promise<SessionPayload | null> {
  let raw: unknown;
  try {
    raw = await unseal(ironCrypto, sealed, getSessionSecret(), sealDefaults);
  } catch {
    return null;
  }

  const parsed = sessionPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - parsed.data.issuedAt;
  if (ageSeconds > SESSION_MAX_AGE_SECONDS) {
    return null;
  }

  return parsed.data;
}

/**
 * Whether auth cookies set the `Secure` attribute. Disabled outside production
 * so sign-in works over local `http://localhost` (browsers drop `Secure`
 * cookies on non-HTTPS); enabled in production, where the app is served over
 * HTTPS. Evaluated per-request — never at module load — to keep `getEnv()` lazy.
 */
export function cookieSecure(): boolean {
  return getEnv().NODE_ENV === "production";
}

/**
 * `Set-Cookie` attributes shared by the session cookie set/clear paths. The
 * `secure` attribute is applied separately via {@link cookieSecure} at the set
 * site so it reflects the runtime environment.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
} as const;
