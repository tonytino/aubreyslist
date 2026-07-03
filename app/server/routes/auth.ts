import { Hono } from "hono";
import type { Context } from "hono";
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
  renderDevLoginPage,
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

/**
 * Resolve the preview tester (creating/reusing a `preview:`-namespaced user, or
 * throwing 403 for a real account), write the SAME sealed session cookie the
 * OAuth callback writes, and redirect to the already-validated `returnTo`.
 * Shared by the GET (`?secret=`) and POST (form body) dev-login paths, called
 * only AFTER the gate + secret check pass.
 */
async function completeDevLogin(
  c: Context,
  email: string | undefined,
  returnTo: string
): Promise<Response> {
  const user = await resolvePreviewUser(email);

  const sessionValue = await createSessionCookieValue(user.id);
  setCookie(c, SESSION_COOKIE_NAME, sessionValue, {
    ...SESSION_COOKIE_OPTIONS,
    secure: cookieSecure(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return c.redirect(new URL(returnTo, c.req.url).toString());
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
  //
  // Two ways in, same gates:
  //   - GET with no secret → serve an HTML sign-in FORM (below), so the tester
  //     enters the secret in a POST body rather than the URL (keeps it out of
  //     history/logs). This is what the header "Dev sign-in" link opens.
  //   - GET/POST with a secret (`?secret=`, `x-preview-login-secret` header, or
  //     the form's POST body) → verify + sign in. The query form stays for
  //     curl/e2e/bookmarked callers.
  .get("/dev-login", async (c) => {
    if (!isPreviewLoginEnabled()) {
      throw new HTTPException(404, { message: "Not Found" });
    }

    const requestUrl = new URL(c.req.url);
    const returnTo = validateReturnTo(c.req.query("returnTo"), requestUrl.origin);
    const secret = c.req.query("secret") ?? c.req.header("x-preview-login-secret");

    // No secret on a GET → render the form so it can be POSTed in the body.
    if (secret === undefined) {
      return c.html(renderDevLoginPage({ returnTo, email: c.req.query("email") }));
    }

    if (!verifyPreviewSecret(secret)) {
      throw new HTTPException(401, { message: "Invalid preview login secret" });
    }

    return completeDevLogin(c, c.req.query("email"), returnTo);
  })

  // Form POST from the sign-in page: the secret arrives in the body, never the
  // URL. On a bad secret we re-render the form with an inline error (nicer than
  // a bare 401 page) but keep the 401 status so scripted callers still see it.
  .post("/dev-login", async (c) => {
    if (!isPreviewLoginEnabled()) {
      throw new HTTPException(404, { message: "Not Found" });
    }

    const body = await c.req.parseBody();
    const secret = typeof body.secret === "string" ? body.secret : undefined;
    const email = typeof body.email === "string" ? body.email : undefined;
    const returnToInput = typeof body.returnTo === "string" ? body.returnTo : undefined;
    const returnTo = validateReturnTo(returnToInput, new URL(c.req.url).origin);

    if (!verifyPreviewSecret(secret)) {
      return c.html(
        renderDevLoginPage({
          returnTo,
          email,
          error: "That secret didn't match. Please try again.",
        }),
        401
      );
    }

    return completeDevLogin(c, email, returnTo);
  })

  // Sign-out: drop the session cookie.
  .post("/sign-out", (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.redirect(new URL("/", c.req.url).toString());
  });
