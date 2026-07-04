# Secret Rotation Runbook — AUB-188

> Operational guide for rotating application secrets safely without data loss.
> Related: [Environment Variables](../agents/environment.md) and
> [Provisioning Guide](./provisioning.md).

---

## Overview

The app uses several secret values for authentication and session signing. Each
rotation procedure is slightly different, and the impact varies. This runbook
covers:

1. **SESSION_SECRET** — signs every session cookie.
2. **GOOGLE_CLIENT_SECRET** — Google OAuth.
3. **PREVIEW_LOGIN_SECRET** — dev-login token (preview-only).

**Golden rule:** Rotate secrets when they may be compromised or on a security
audit. Plan for the impact each rotation causes (global logout, etc.).

---

## SESSION_SECRET Rotation

**Impact:** Invalidates **all active session cookies globally.** Every user is
logged out. No data loss — roles and profiles live in the database and survive
the logout.

**When:** if the secret leaks, on a routine security rotation schedule (e.g.,
quarterly), or after a security audit.

**Time:** ~5–10 minutes (update + verify).

### Procedure

1. **Generate a new secret:**

   ```bash
   openssl rand -base64 32
   ```

   Copy the output (e.g., `abc123XYZ...==`).

2. **Update Vercel environment:**

   - Go to [Vercel Dashboard](https://vercel.com) → select the
     **aubreyslist** project.
   - **Settings → Environment Variables**.
   - Find `SESSION_SECRET` → **Edit** → paste the new secret → **Save**.
   - **Important:** ensure it's set for **Production** (and Preview if desired,
     but Production is required). Leave Development unset unless you explicitly
     want to rotate local secrets too.

3. **Redeploy the app:**

   The environment variable takes effect **only on a new deployment**. Either:

   - **Automatic:** push a dummy commit to `main` (e.g., update a comment or
     `.env.example`), and the CI workflow redeploys automatically.
   - **Manual:** go to Vercel **Deployments** → **Redeploy** (or run `vercel
     deploy --prod` locally with a Vercel CLI token).

4. **Verify the new secret is live:**

   - Once redeployed, visit [aubreyslist.vercel.app](https://aubreyslist.vercel.app).
   - **Every browser tab is logged out** (no session cookie can unseal with the
     old secret).
   - Users signing in again will get a fresh session with the new secret. The
     login flow works normally.

5. **Optional: update local `.env` (if you maintain one):**

   ```bash
   SESSION_SECRET=<new-secret>
   ```

   This is **not required** unless you're testing sign-in locally. The app boots
   without SESSION_SECRET set (it's optional at env-validation time outside
   production). Sign-in (sealing a new session cookie) throws immediately if
   it's unset, regardless of environment; unsealing an existing cookie fails
   soft instead — the unseal error is swallowed and the request is simply
   treated as signed-out. Updating `.env` is necessary to test the sign-in
   flow locally.

### Impact

- All users are logged out.
- No permanent data loss.
- Role, profile, and account metadata re-hydrate from the database on next
  sign-in.
- Favorites, claims, and all user data are intact — only the session token is
  invalid.

---

## GOOGLE_CLIENT_SECRET Rotation

**Impact:** Invalidates the current OAuth flow. Users cannot sign in until the
old secret is revoked in Google Cloud.

**When:** if the secret leaks, or on a routine security rotation (e.g.,
quarterly). **Unlike SESSION_SECRET, this requires Google Cloud Console access.**

**Time:** ~10–15 minutes (Google Cloud setup + Vercel update + redeploy).

### Procedure

1. **In [Google Cloud Console](https://console.cloud.google.com):**

   - Go to **APIs & Services → Credentials**.
   - Find the OAuth 2.0 Client ID for Aubrey's List (typically labeled "Web
     application").
   - Click it to open the details.

2. **Create a new Client ID:**

   - On the client details page, you cannot edit the secret itself — you create
     a new one.
   - **Download** the old credentials JSON (for reference — shows the old secret).
   - **Create a new OAuth 2.0 Client ID** (same flow as initial setup):
     Application type **Web application**, same authorized origins/redirects.
   - **Download** or copy the new **Client ID** and **Client Secret**.

3. **Update Vercel environment:**

   - Go to [Vercel Dashboard](https://vercel.com) → **aubreyslist** project.
   - **Settings → Environment Variables**.
   - Update `GOOGLE_CLIENT_ID` (if changed) and `GOOGLE_CLIENT_SECRET` with the
     new values.
   - **Save.**

4. **Redeploy:**

   Same as SESSION_SECRET — push a commit to `main` or manually redeploy from
   Vercel.

5. **Back to Google Cloud Console: delete the old client:**

   - Once the new secret is live in production (redeploy confirmed), return to
     the OAuth credentials page.
   - **Delete** the old OAuth 2.0 Client ID to fully revoke it and prevent
     accidental reuse.

6. **Verify sign-in works:**

   - Once redeployed, visit the app and try signing in with Google.
   - The OAuth flow should complete normally with the new secret.
   - If users are already signed in (old session still valid), they won't see
     the OAuth flow until they log out and back in.

### Gotchas

- **Old sessions don't immediately log out** — the session cookie doesn't use
  the GOOGLE_CLIENT_SECRET (it uses SESSION_SECRET). So existing users stay
  logged in.
- **New sign-ups must happen after redeploy** — if someone tries to sign in
  before the new secret is live, Google will reject the request.
- **Authorized origins/redirects:** if you're also changing the Vercel URL or
  callback path, update those in Google Cloud **before** creating the new client
  ID, or you'll get a redirect mismatch.

---

## PREVIEW_LOGIN_SECRET Rotation

**Impact:** Invalidates the dev-login endpoint (`/api/auth/dev-login`). Preview
testers cannot use the shortcut sign-in until the new secret is provided.

**When:** if the secret leaks, or on a routine security rotation. This secret is
**preview-only**, so production is unaffected.

**Time:** ~5 minutes.

### Procedure

1. **Generate a new secret:**

   ```bash
   openssl rand -base64 32
   ```

2. **Update Vercel environment:**

   - Go to [Vercel Dashboard](https://vercel.com) → **aubreyslist** project.
   - **Settings → Environment Variables**.
   - Find `PREVIEW_LOGIN_SECRET` → **Edit** → paste the new secret → **Save**.
   - **Important:** ensure the **scope is set to Preview only**, NOT Production.
     (The endpoint is gated to fail-closed in production anyway, but keep the
     secret out of prod scope.)

3. **Redeploy:**

   Push to a branch or trigger a preview deployment. Once redeployed, the new
   secret is live in previews.

4. **Notify preview testers:**

   - Any dev-login shortcuts or forms used by testers will now reject the old
     secret.
   - Provide testers the new secret (in your team chat, not in logs/URLs) and
     they can use the form or header link to sign in again.

### Gotchas

- **This only affects preview deployments**, not production.
- **Never set PREVIEW_LOGIN_SECRET in the Production scope** — the gating logic
  refuses to enable the endpoint if it detects a production environment.
- **Test sign-in works** on a preview URL after redeploy, using the new secret.

---

## Rotation Schedule (Recommendation)

Consider a routine rotation schedule for non-emergency rotations:

| Secret                 | Interval | Trigger                            |
| ---------------------- | -------- | ---------------------------------- |
| SESSION_SECRET         | Quarterly | Schedule or after security audit  |
| GOOGLE_CLIENT_SECRET   | Quarterly | Schedule or after security audit  |
| PREVIEW_LOGIN_SECRET   | As-needed | Lower risk (preview-only); rotate only if leaked |

Document rotations in a private changelog or security log (not in the repo) for
compliance/audit purposes.

---

## Checklist: Secret Rotation

### For SESSION_SECRET:

- [ ] Generate new secret: `openssl rand -base64 32`.
- [ ] Update `SESSION_SECRET` in Vercel **Production** environment.
- [ ] Redeploy (commit to main or manual redeploy).
- [ ] Verify all users are logged out (no valid session cookies).
- [ ] Test sign-in works normally.

### For GOOGLE_CLIENT_SECRET:

- [ ] Generate new OAuth client in Google Cloud Console.
- [ ] Copy new **Client ID** and **Client Secret**.
- [ ] Update `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel
  **Production** environment.
- [ ] Redeploy.
- [ ] Delete old OAuth client from Google Cloud (optional but recommended).
- [ ] Verify sign-in works with new secret.

### For PREVIEW_LOGIN_SECRET:

- [ ] Generate new secret: `openssl rand -base64 32`.
- [ ] Update `PREVIEW_LOGIN_SECRET` in Vercel **Preview** scope (NOT Production).
- [ ] Redeploy a preview.
- [ ] Test dev-login form with new secret on the preview.
- [ ] Notify testers of the new secret.

---

## Emergency: Suspected Compromise

If a secret may be compromised **and you need to rotate immediately:**

1. **Do not wait for a scheduled redeploy.** Trigger a production redeploy
   immediately from the Vercel UI (**Deployments → Redeploy**) or via CLI.
2. **Update the environment variable** in Vercel *before* redeploying, so the
   new value is baked into the deployment.
3. **Notify stakeholders** if SESSION_SECRET rotation causes a global logout.
4. **For GOOGLE_CLIENT_SECRET:** revoke the old client in Google Cloud Console
   immediately after confirming the new one is live, to prevent the old secret
   from being used.

---

## Related Docs

- [Environment Variables](../agents/environment.md) — full list of secrets and
  how they're provisioned.
- [Provisioning Guide](./provisioning.md) — initial setup of these secrets.
- `app/server/auth/session.ts` — implementation of how SESSION_SECRET is used
  to seal/unseal cookies; see the header comment for the session design.
