import { seal, defaults as sealDefaults, unseal } from "iron-webcrypto";
import { z } from "zod";
import { getEnv } from "~/env";

/**
 * Stateless, server-signed session.
 *
 * ADR-006: no `sessions` table — the session is a sealed (signed + encrypted)
 * cookie. `iron-webcrypto` is used directly so seal/unseal works from both the
 * Hono auth routes (raw `Request`, no h3 event) and server functions. The
 * cookie holds only the user id; the user row is always re-read from the DB,
 * so a stale or forged cookie can never elevate a session.
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
 * Read the session signing secret, throwing if unset.
 *
 * `SESSION_SECRET` is `optional()` in `app/env.ts` (CI lacks it), so guard at
 * the point of use: auth fails loudly here rather than signing with nothing.
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

/** Seal a session payload into an opaque cookie value. */
export async function sealSessionPayload(payload: SessionPayload): Promise<string> {
  return seal(payload, getSessionSecret(), sealDefaults);
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
    raw = await unseal(sealed, getSessionSecret(), sealDefaults);
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
