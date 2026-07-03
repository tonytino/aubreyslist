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
  isPreviewLoginEnabled,
  resolvePreviewUser,
  verifyPreviewSecret,
} from "../auth/preview-login";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
  cookieSecure,
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
const RETURN_TO_COOKIE_NAME = "al_oauth_return_to";
// Short-lived: the OAuth round-trip should complete in well under 10 minutes.
const OAUTH_TX_MAX_AGE_SECONDS = 60 * 10;

/**
 * Open-redirect defense for the post-sign-in `returnTo`. Returns the original
 * path only when it is unambiguously a same-origin, single-slash-rooted local
 * path; otherwise falls back to `/`. Kept pure + exported so it can be
 * unit/fuzz-tested in isolation.
 *
 * `returnTo` is NEVER round-tripped through Google's OAuth `state`; it lives in
 * a short-lived httpOnly cookie set alongside the other transaction cookies.
 */
export function validateReturnTo(returnTo: string | undefined, requestOrigin: string): string {
  const fallback = "/";
  if (!returnTo) {
    return fallback;
  }

  // Must be a path rooted at a single `/` — rejects `//host`, `/\host`
  // (protocol-relative / backslash tricks) and absolute URLs like `https://…`.
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.startsWith("/\\")) {
    return fallback;
  }

  // No control characters (defends against CRLF header injection).
  if (/[\r\n\t]/.test(returnTo)) {
    return fallback;
  }

  // Percent-encoded escapes (e.g. `%2f%2f`, `%5c`) must not decode into a
  // `//` or `/\` that would smuggle in a protocol-relative redirect.
  let decoded: string;
  try {
    decoded = decodeURIComponent(returnTo);
  } catch {
    return fallback;
  }
  if (decoded.includes("//") || decoded.includes("/\\")) {
    return fallback;
  }

  // Final origin check: resolving against the request origin must stay on it.
  try {
    if (new URL(returnTo, requestOrigin).origin !== requestOrigin) {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return returnTo;
}

const TX_COOKIE_BASE = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
  maxAge: OAUTH_TX_MAX_AGE_SECONDS,
} as const;

/** Transaction-cookie attributes with the env-aware `secure` flag applied. */
function txCookieOptions() {
  return { ...TX_COOKIE_BASE, secure: cookieSecure() } as const;
}

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

    setCookie(c, STATE_COOKIE_NAME, state, txCookieOptions());
    setCookie(c, VERIFIER_COOKIE_NAME, codeVerifier, txCookieOptions());

    // Stash a validated `returnTo` in a short-lived tx cookie (never via OAuth
    // `state`). Only same-origin local paths survive validation.
    const returnTo = validateReturnTo(c.req.query("returnTo"), new URL(c.req.url).origin);
    if (returnTo !== "/") {
      setCookie(c, RETURN_TO_COOKIE_NAME, returnTo, txCookieOptions());
    }

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
    const returnToCookie = getCookie(c, RETURN_TO_COOKIE_NAME);

    // Always clear the transaction cookies — they are single-use.
    deleteCookie(c, STATE_COOKIE_NAME, { path: "/" });
    deleteCookie(c, VERIFIER_COOKIE_NAME, { path: "/" });
    deleteCookie(c, RETURN_TO_COOKIE_NAME, { path: "/" });

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
      secure: cookieSecure(),
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    // Land back on the requested same-origin path (re-validated), now signed
    // in; default to the home page when no valid `returnTo` was stashed.
    const requestUrl = new URL(c.req.url);
    const returnTo = validateReturnTo(returnToCookie, requestUrl.origin);
    return c.redirect(new URL(returnTo, requestUrl).toString());
  })

  // Preview-only dev-login (AUB-138): mint a session WITHOUT Google so a tester
  // can sign in on a Vercel per-deployment preview URL (where OAuth's
  // exact-match redirect URIs can't be registered). Prod-inert + double-gated:
  //   1. 404 unless `isPreviewLoginEnabled()` (not Vercel production + a secret
  //      is provisioned) — invisible in production.
  //   2. 401 unless the caller presents the correct `PREVIEW_LOGIN_SECRET`
  //      (constant-time compared).
  // On success it writes the SAME sealed session cookie as the OAuth callback
  // and lands on a `validateReturnTo`-checked path (never an open redirect).
  .get("/dev-login", async (c) => {
    if (!isPreviewLoginEnabled()) {
      throw new HTTPException(404, { message: "Not Found" });
    }

    const secret = c.req.query("secret") ?? c.req.header("x-preview-login-secret");
    if (!verifyPreviewSecret(secret)) {
      throw new HTTPException(401, { message: "Invalid preview login secret" });
    }

    const user = await resolvePreviewUser(c.req.query("email"));

    const sessionValue = await createSessionCookieValue(user.id);
    setCookie(c, SESSION_COOKIE_NAME, sessionValue, {
      ...SESSION_COOKIE_OPTIONS,
      secure: cookieSecure(),
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    const requestUrl = new URL(c.req.url);
    const returnTo = validateReturnTo(c.req.query("returnTo"), requestUrl.origin);
    return c.redirect(new URL(returnTo, requestUrl).toString());
  })

  // Sign-out: drop the session cookie.
  .post("/sign-out", (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.redirect(new URL("/", c.req.url).toString());
  });
