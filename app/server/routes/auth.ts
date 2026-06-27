import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  buildAuthorizationUrl,
  deriveCodeChallenge,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  generateRandomToken,
} from "../auth/google";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
  createSessionCookieValue,
} from "../auth/session";
import { upsertUserFromGoogle } from "../auth/users";

/**
 * Google sign-in/out (ADR-006). Mounted at `/api/auth`:
 *
 * - `GET /api/auth/google`          → start the flow (redirect to Google)
 * - `GET /api/auth/callback/google` → exchange code → upsert user → set session
 * - `POST /api/auth/sign-out`       → clear the session cookie
 *
 * The callback path is fixed at `/api/auth/callback/google` — the human
 * provisioned Google's authorized redirect URI to exactly this path.
 *
 * CSRF + PKCE state is carried in short-lived, httpOnly cookies set when the
 * flow starts and verified (then cleared) on the callback.
 */

const STATE_COOKIE_NAME = "al_oauth_state";
const VERIFIER_COOKIE_NAME = "al_oauth_verifier";
// Short-lived: the OAuth round-trip should complete in well under 10 minutes.
const OAUTH_TX_MAX_AGE_SECONDS = 60 * 10;

const TX_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
  maxAge: OAUTH_TX_MAX_AGE_SECONDS,
} as const;

/** Compute the absolute callback URL from the incoming request's origin. */
function callbackUrl(requestUrl: string): string {
  return new URL("/api/auth/callback/google", requestUrl).toString();
}

export const authRoutes = new Hono()
  // Initiate sign-in: stash state + PKCE verifier, redirect to Google.
  .get("/google", async (c) => {
    const state = generateRandomToken();
    const codeVerifier = generateRandomToken();
    const codeChallenge = await deriveCodeChallenge(codeVerifier);

    setCookie(c, STATE_COOKIE_NAME, state, TX_COOKIE_OPTIONS);
    setCookie(c, VERIFIER_COOKIE_NAME, codeVerifier, TX_COOKIE_OPTIONS);

    const authUrl = buildAuthorizationUrl({
      redirectUri: callbackUrl(c.req.url),
      state,
      codeChallenge,
    });
    return c.redirect(authUrl);
  })

  // OAuth callback: verify state, exchange code, upsert user, set session.
  .get("/callback/google", async (c) => {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) {
      throw new HTTPException(400, { message: `Google sign-in failed: ${oauthError}` });
    }

    const expectedState = getCookie(c, STATE_COOKIE_NAME);
    const codeVerifier = getCookie(c, VERIFIER_COOKIE_NAME);

    // Always clear the transaction cookies — they are single-use.
    deleteCookie(c, STATE_COOKIE_NAME, { path: "/" });
    deleteCookie(c, VERIFIER_COOKIE_NAME, { path: "/" });

    if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
      throw new HTTPException(400, { message: "Invalid OAuth state or missing code" });
    }
    if (!codeVerifier) {
      throw new HTTPException(400, { message: "Missing PKCE verifier" });
    }

    const { accessToken } = await exchangeCodeForTokens({
      code,
      redirectUri: callbackUrl(c.req.url),
      codeVerifier,
    });
    const profile = await fetchGoogleUserInfo(accessToken);
    const user = await upsertUserFromGoogle(profile);

    const sessionValue = await createSessionCookieValue(user.id);
    setCookie(c, SESSION_COOKIE_NAME, sessionValue, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    // Land back on the home page, now signed in.
    return c.redirect(new URL("/", c.req.url).toString());
  })

  // Sign-out: drop the session cookie.
  .post("/sign-out", (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.redirect(new URL("/", c.req.url).toString());
  });
