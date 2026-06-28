import { z } from "zod";
import { getEnv } from "~/env";

/**
 * Minimal, hand-rolled Google OAuth 2.0 authorization-code flow (ADR-006:
 * Google is the sole provider). We avoid an OAuth dependency: the flow is a
 * small, well-specified set of `fetch` calls. We handle CSRF with the `state`
 * parameter and additionally use PKCE (S256), so the flow is hardened even
 * though Google issues a client secret.
 *
 * Secrets (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) are read lazily via
 * `getEnv()` and guarded here — they stay `optional()` in `app/env.ts` so CI
 * (which lacks them) stays green, and the auth routes throw a clear error if a
 * sign-in is attempted without them.
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/** OAuth scopes — basic sign-in only (openid + email + profile), per ADR-006. */
const SCOPES = ["openid", "email", "profile"] as const;

interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

/** Read + validate the Google OAuth credentials, throwing if unprovisioned. */
function getGoogleCredentials(): GoogleCredentials {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. Google sign-in requires both — see docs/setup/provisioning.md."
    );
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

/** Base64url-encode bytes (no padding) — used for state, verifier, challenge. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a cryptographically random base64url token. */
export function generateRandomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Derive the S256 PKCE code challenge from a verifier. */
export async function deriveCodeChallenge(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Build the Google authorization URL to redirect the user to. The caller is
 * responsible for persisting `state` and `codeVerifier` (in short-lived cookies)
 * to verify on the callback.
 */
export function buildAuthorizationUrl(params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const { clientId } = getGoogleCredentials();
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Always re-prompt account selection; avoids silently reusing a stale account.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  id_token: z.string().optional(),
});

/** Exchange an authorization code (+ PKCE verifier) for an access token. */
export async function exchangeCodeForTokens(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ accessToken: string }> {
  const { clientId, clientSecret } = getGoogleCredentials();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status})`);
  }

  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("Google token response was malformed");
  }
  return { accessToken: parsed.data.access_token };
}

/** The subset of Google's OpenID userinfo we persist. `sub` is the stable id. */
const userInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  // `email_verified` can arrive as a boolean or the string "true"/"false".
  email_verified: z.union([z.boolean(), z.string()]).optional(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
});

export type GoogleUserInfo = z.infer<typeof userInfoSchema>;

/** Fetch the authenticated user's profile from Google's userinfo endpoint. */
export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Google userinfo request failed (${res.status})`);
  }

  const parsed = userInfoSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("Google userinfo response was malformed");
  }
  return parsed.data;
}
