# Setup & Provisioning Guide (Human / Bucket 1)

> Step-by-step for the account/secret tasks only the repo owner can do. These
> unblock the agent build pipeline. Corresponds to issues **#14, #19, #21, #42**.
>
> **Note on exact names:** the env-var **names** are now finalized in
> `app/env.ts` / `.env.example` by #44 (`DATABASE_URL`, `GOOGLE_CLIENT_ID`,
> `GOOGLE_CLIENT_SECRET`, `GOOGLE_PLACES_API_KEY`, `SESSION_SECRET`) and match
> the names below. The OAuth **callback path** is still finalized by the auth
> sub-issue (#15). If the implemented code ever differs, the code wins; update
> accordingly.

All secrets go in **two places**: your local `.env` (gitignored) and the
**Vercel project env** (set during #42). **Never commit secrets.**

---

## Recommended order

There's a small chicken-and-egg between Google OAuth and Vercel (OAuth needs the
deployed URL). Do it in this order:

1. **Neon** (#19) — no dependencies.
2. **Google Cloud project + OAuth** (#14) — configure with `localhost` first.
3. **Google Places key** (#21) — same Google Cloud project.
4. **Vercel** (#42) — set all env vars, deploy, get the `*.vercel.app` URL.
5. **Back to Google OAuth** — add the Vercel URL to authorized origins/redirects.

---

## 1. Neon database — issue #19

1. Go to [neon.tech](https://neon.tech) and sign in (GitHub login works).
2. **New Project** → pick a US region close to Denver (e.g. AWS `us-east-2` Ohio
   or a US-central option) → **Create Project**.
3. Open **Connection Details** → copy the connection string. Either **Pooled** or
   **Direct** works (this template uses Neon's HTTP driver, so the `-pooler`
   distinction doesn't matter).
4. Set it as:
   ```bash
   DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
   ```
   Add to local `.env` now; add to Vercel env in step 4.
5. Hand off `DATABASE_URL` so migrations (`pnpm db:migrate`) can be applied once
   the schema (#20) lands.

---

## 2. Google Cloud project + OAuth — issue #14

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. **Create a project** (e.g. "Aubrey's List"). Use this same project for Places.
3. **OAuth consent screen** (APIs & Services → OAuth consent screen):
   - User type: **External**.
   - App name: **Aubrey's List**; user support email + developer email.
   - Scopes: `openid`, `email`, `profile` (basic sign-in).
   - Add yourself (and Aubrey) as **Test users** while the app is unverified.
4. **Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins:** `http://localhost:3000` (add the Vercel
     URL later in step 5).
   - **Authorized redirect URIs:** add the callback for both local and prod. The
     expected default path is `…/api/auth/callback/google` — **confirm against
     #15's implementation**. Start with
     `http://localhost:3000/api/auth/callback/google`.
5. Copy the **Client ID** and **Client secret**:
   ```bash
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
6. Generate a session secret (any long random string):
   ```bash
   SESSION_SECRET=$(openssl rand -hex 32)   # or any 32+ char random string
   ```
   (Exact var name confirmed by #15.)

---

## 3. Google Places API key — issue #21

> Places requires a **billing account attached** to the Google Cloud project,
> even to use the recurring free allowance. Adding billing does not mean you'll
> be charged within the free tier — but it must be enabled. The app's **admin
> intake toggle** lets you fall back to manual entry if you approach the limit
> (ADR-008), so you're protected from surprise bills.

1. In the **same** Google Cloud project: **APIs & Services → Enable APIs** →
   enable **Places API** (enable "Places API (New)" if the provider in #22 uses
   it; #22 will specify).
2. **Billing** → attach a billing account to the project (required for Places).
3. **Credentials → Create Credentials → API key.**
4. **Restrict the key** (Credentials → the key → Restrictions): restrict to the
   **Places API** only. We call Places **server-side**, so keep this key secret
   and do **not** expose it to the browser.
5. Set it:
   ```bash
   GOOGLE_PLACES_API_KEY=...
   ```

---

## 4. Vercel project — issue #42

1. At [vercel.com](https://vercel.com), **Add New → Project** → import
   `tonytino/aubreyslist`. Stay on the **free/hobby** tier (ADR-009).
2. Framework should auto-detect (TanStack Start / Vinxi). If the build needs a
   preset, that's wired by #43 — you may deploy once #43 lands; for now just
   create the project and set env.
3. **Project → Settings → Environment Variables** — add:
   ```
   DATABASE_URL
   GOOGLE_CLIENT_ID
   GOOGLE_CLIENT_SECRET
   GOOGLE_PLACES_API_KEY
   SESSION_SECRET
   ```
   (Use the same values as your local `.env`.)
4. Deploy → note the free **`https://<project>.vercel.app`** URL. Hand it off.

---

## 5. Finish Google OAuth (after you have the Vercel URL)

Back in **Google Cloud → Credentials → your OAuth client**:
- **Authorized JavaScript origins:** add `https://<project>.vercel.app`.
- **Authorized redirect URIs:** add
  `https://<project>.vercel.app/api/auth/callback/google` (match #15's actual
  path).

---

## Auth on preview deployments

Google OAuth requires **exact-match redirect URIs — no wildcards.** You cannot
register `https://*-brbcoding.vercel.app/...`, so every origin/callback must be
spelled out.

Vercel preview URLs come in two forms:

- **Per-deployment** (e.g. `aubreyslist-<hash>-brbcoding.vercel.app`) — a new
  hash every push, so **not registerable**.
- **Per-branch** (e.g. `aubreyslist-git-<branch>-brbcoding.vercel.app`) —
  **stable per branch**, so it CAN be registered.

**To test sign-in on a specific preview branch**, in the Google Cloud OAuth
client add:

- **Authorized JavaScript origin:**
  `https://aubreyslist-git-<branch>-brbcoding.vercel.app`
- **Authorized redirect URI:**
  `https://aubreyslist-git-<branch>-brbcoding.vercel.app/api/auth/callback/google`

**Recommended:** test auth on `http://localhost:3000` and prod
`https://aubreyslist.vercel.app` (both already registered). Only register a
branch preview URL if you need repeated sign-in testing on it. (The session
cookie's `Secure` flag is gated on `NODE_ENV=production`, so local
`http://localhost` sign-in works.)

**Advanced / not needed at pilot scale:** a single fixed callback domain plus a
`state`-based redirect proxy enables auth on *any* preview URL, at the cost of an
auth-proxy code path.

---

## Where this plugs into the build

- `DATABASE_URL` → unblocks applying migrations for the core schema (#20).
- Google OAuth creds → unblock sign-in/session (#15).
- `GOOGLE_PLACES_API_KEY` → unblocks the Places provider (#22).
- Vercel project + URL → unblock deploy config (#43) and launch.

Keep `.env.example` (#44) as the source of truth for the full required set; if
the implemented var names differ from this guide, trust the code.
