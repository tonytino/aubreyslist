# Tech Spec: Favorite Listings

_Status: Reviewed rev.3 (passed adversarial Rounds 1-2, cap reached, all findings applied). Home: Aubrey's List — Favorites Linear project (team AUB)._

## 1. Problem & context

Every listing card renders a heart button (`app/components/listing/ListingCard.tsx` ~L199-209,
`aria-label="Save this spot"`) that is **dead markup** — its own code comment says "present but not wired
(Phase 2)." Users can click it and nothing happens. We are wiring it into a full favorites feature: a
signed-in user can save/unsave any listing, view their saved spots on a dedicated page, filter the
directory to only their saved spots, and see a public save-count on cards. Logged-out users see the heart
and, on click, are prompted (modal) to sign in — never a silent no-op.

The feature maps almost 1:1 onto the existing **attestations (vote)** feature — a login-gated per-
`(user, entity)` write — so we copy proven patterns rather than invent.

## 2. Goals & non-goals

**Goals (v1)**
- Everyone sees the heart; anonymous click → modal sign-in prompt.
- Signed-in click toggles a persisted favorite (add/remove), optimistic + instant.
- Heart works on browse cards, the map carousel, and the listing detail page.
- Dedicated `/favorites` page listing the viewer's saved spots (cards identical to browse).
- A "Saved" quick-filter in the directory that shows the viewer's **complete** saved set (server-side).
- Public save-count on cards, styled distinctly from the safety signal (ADR-007).
- After signing in from a heart click, the user returns to the listing and the favorite auto-completes.

**Non-goals (v1)**
- Favorites-based sorting/ranking, shared/public lists, collections/folders, notifications, email digests.
- Any coupling between save-count and the celiac-safety verdict.

## 3. Data model

New `favorites` table in `db/schema.ts`, mirroring `attestations` but **create-or-delete** (a favorite is
never mutated, so **no `updatedAt`**):

```ts
export const favorites = pgTable("favorites", {
  id: id(),                                                    // text uuid PK, crypto.randomUUID()
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [
  unique("favorites_user_listing_unique").on(t.userId, t.listingId),  // one save per (user, listing)
  index("favorites_user_idx").on(t.userId),                            // "my favorites" reads
  index("favorites_listing_idx").on(t.listingId),                      // count / listing-scoped reads
]);
export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
```

- No moderation column: a favorite is a **private edge**, never public content. Visibility is enforced at
  **read** time by joining to `listings.moderationStatus`.
- Cascade FKs are a safety net; the app soft-moderates (never hard-deletes), so cascade is not the normal
  path (same reasoning as `flags`/`attestations`).
- Rollout: `pnpm db:generate` → migration; prod applied by CI (`migrate.yml`) on merge to `main`. `safe:human`.

## 4. Server API (`app/server/favorites/`, copying the attestations 3-file split)

**`index.ts`** (server-only; imports `getDb`, guards, rate-limit):

- `addFavorite({ listingId })` — `requireCurrentUser()` → `enforceWriteLimit(user.id)` → verify listing
  exists **and** `moderationStatus === "visible"` (else 404-style throw) →
  `insert(favorites)…onConflictDoNothing({ target: [userId, listingId] })`. Idempotent; concurrent-safe.
- `removeFavorite({ listingId })` — `requireCurrentUser()` → `enforceWriteLimit` → `delete where userId &&
  listingId`. No-op when absent.
- `getViewerFavoriteIds(): string[]` — `getCurrentUser()`; `null` → `[]` (no DB hit). Else select
  `favorites.listingId` INNER JOIN `listings` filtered to `moderationStatus="visible"`.
- `getViewerFavorites(now, months): BrowseListingCard[]` — for `/favorites`. `null` → `[]`. Else join
  `favorites → listings` (visible) and reuse the browse trust derivation (below), **also attaching
  `getFavoriteCounts`** so the save-count pill renders identically to browse (Round-2 fix — otherwise the
  count would silently vanish on `/favorites`). **v1 loads the full set unbounded** — favorites lists are
  small in practice; a cap is a noted follow-up (§11). Ordered by `favorites.createdAt DESC`.
- `getFavoriteCounts(listingIds): Map<string, number>` — public aggregate: grouped count over `favorites`
  for the given listing ids. User-agnostic (safe in the shared browse payload).

**Browse reuse (safety-critical — see §11.3).** Extract the browse "listings→cards" tail into a
**server-only** `buildBrowseCards(listings, now, months)` helper. It owns ONLY the ADR-007 trust-glance
derivation (`getCeliacAggregatesByListing` + `getRecentIncidentDatesByListing` + `deriveListingTrustGlance`);
**distance-label logic stays in `getBrowseListings`** (favorites/`/favorites` have no distance origin).
Both `getBrowseListings` and `getViewerFavorites` call it, guaranteeing byte-identical cards. This
extraction is its **own issue (F3)** gated by a golden regression test asserting browse output is unchanged
before/after — it is not a mechanical lift.

**Server-side "Saved" directory filter (fixes the Round-1 blocker).** The browse server fn
(`getBrowseListings`) gains an optional `savedOnly` mode: when set and the caller is signed in, it
constrains the query to `listings.id IN (viewer's visible favorite ids)` **before** paginating, so
`page`/`total`/`hasMore` remain honest over the favorites subset — NOT a client-side filter over the loaded
page (the existing quick chips are page-scoped by design; favorites must not be). Anonymous `savedOnly` →
empty result (the control is sign-in-gated in the UI anyway).

> **Caching caveat (Round-2 fix).** Under `savedOnly` the browse response is **viewer-specific/private**,
> not user-agnostic: its query key (`["browse-listings", …, saved]`) carries no identity yet two signed-in
> users share it with different data. So a `savedOnly` browse response must **Vary on session and never be
> shared/edge/CDN-cached** (it inherits the §11.1 no-public-cache rule). Only the non-`savedOnly` browse
> payload + the public save-count remain user-agnostic.

**`favorites.fn.ts`** (the ONLY module client code imports) — thin `createServerFn` wrappers:
`favoriteListing`/`unfavoriteListing` (POST, validated), `fetchViewerFavoriteIds` (GET),
`fetchViewerFavorites` (GET). Counts and `savedOnly` are folded into the existing browse fn, not new ones.

**Client-safe input schema** — `favoriteInputSchema = z.object({ listingId: z.string().min(1) })`
(`app/listings/favorite-input.ts`).

## 5. Data loading & caching

Two distinct axes, treated differently on purpose:

- **Per-user `isFavorited`** → a dedicated **`["favorites"]` viewer-ids query** resolved from the session
  cookie each request (`app/favorites/favorites-query.ts`), prefetched in `__root.tsx`. It is **NOT** folded
  into the user-agnostic browse payload: the browse key (`["browse-listings", page, attrs, …]`) has no
  viewer identity, so baking per-user state into it would let a dehydrated/shared/edge-cached render surface
  one user's saves to another. Sign-in/out are full-page reloads, so the dehydrated snapshot never crosses
  sessions. Anon short-circuits to `[]` (no DB hit). Every heart reads O(1) via `new Set(ids).has(id)`.
- **Public save-count** → **user-agnostic**, so it *does* augment the browse payload and the card VM.
  `getFavoriteCounts` results are attached in `getBrowseListings` **and `getViewerFavorites`**, threaded
  through **`RestaurantCardVM` + `listingToCardVM`** (an accepted, intentional mapper change — counts are
  public, unlike `isFavorited`; the count is a plain number, so no server-only import reaches the client-safe card).

This resolves the Round-1 §5/§6 contradiction: the mapper IS extended for the public count; only the
per-user `isFavorited` is kept out of the VM and read by the `FavoriteButton` island. Note the one exception
to "browse payload is user-agnostic": the `savedOnly` mode (§4 caveat) is per-viewer and uncacheable.

## 6. UX

**`FavoriteButton.tsx`** — self-contained client island, props `{ listingId, listingName? }`. Reads
`favoriteIdsQuery` + `currentUserQuery` itself, so per-user state never touches the VM. Drops into browse
cards, map carousel, detail page as `<FavoriteButton listingId={id} />`. Reuses the existing button's
position/classes + `Heart`.

- **Optimistic toggle** (deliberately diverging from votes' invalidate-on-success — a heart is a binary the
  client fully knows and must feel instant): `onMutate` cancels `["favorites"]`, snapshots, flips the id;
  `onError` rolls back + toasts; `onSettled` invalidates to reconcile. `disabled` while pending;
  `cancelQueries` guards double-click races.
- Accessibility (styling.md — never colour alone): `aria-pressed`, label flips "Save {name}" / "Saved —
  remove {name}", fill via `fill-current` **plus** the label.
- **Anonymous click → Radix modal Dialog** (`app/components/ui/dialog.tsx`): explains favorites; "Sign in" →
  `/api/auth/google?returnTo=<current-path-with-save-marker>`. No write attempted while anonymous.

**Public save-count pill** — rendered on the card from the VM count field (§5). Governed by the **same
ADR-007 treatment as the existing `googleRating` pill** (`ListingCard.tsx` L137-146): attributed, colour +
label, visually subordinate, and **never adjacent to `SafetySignal`**. Hidden (or shown as "—") when zero.

**"Saved" directory filter** — a sign-in-gated control in the directory filter row that drives the
server-side `savedOnly` browse mode (§4) via a URL param (e.g. `?saved=1`), so it paginates and counts
honestly over the full favorites set. Signed-out: the control opens the same sign-in dialog.

**`/favorites` page** (`app/routes/favorites.tsx`) — loader prefetches `["viewer-favorites"]` +
`favoriteIdsQuery`. States: anonymous → empty state + sign-in link (`returnTo=/favorites`); signed-in empty
→ "No saved spots yet — tap the heart on any listing" + link to `/listings`; signed-in populated → reuse
`DirectoryList`/`RestaurantCard`. Add a nav/`UserMenu` entry.

## 7. Logged-out flow & OAuth return-to / auto-save

- Anonymous heart click opens the **modal Dialog**; "Sign in" navigates to
  `/api/auth/google?returnTo=<relative path>` where the path carries a `?save=<listingId>` marker.
- **Extend `app/server/routes/auth.ts`.** `/google` reads `returnTo` and validates it, storing the accepted
  value in a short-lived **httpOnly** cookie alongside the existing `al_oauth_state`/`al_oauth_verifier`
  transaction cookies (`txCookieOptions`, ~L34-49) — **never** via Google's `state`. `/callback/google`
  (today hardcodes redirect `/`, L115) redirects to the validated `returnTo`, default `/`.
- **`returnTo` validation (open-redirect defense, hardened per Round 1).** Accept only when: the raw string
  starts with a single `/` (reject `//`, `/\`, protocol-relative, and absolute URLs); it contains no
  control chars (CR/LF/tab) and no percent-encoded `//` (`%2f%2f`) after decoding; and
  `new URL(returnTo, requestOrigin).origin === requestOrigin`. **Query strings are permitted** so the
  `?save=` marker survives. Default to `/` on any rejection. Fuzz cases in tests: `//evil.com`,
  `https://evil`, `/\evil`, `%2f%2fevil`, CRLF-injected, and a valid `/listings/x?save=y`.
- **Auto-save.** On return, the client reads the `?save=<listingId>` marker, fires `favoriteListing` **exactly
  once**, then strips the marker from the URL (`replaceState`). Idempotent (unique constraint +
  `onConflictDoNothing`) so a re-navigation can't double-write; the server `addFavorite` re-checks the
  listing is visible. **Accepted risk (documented):** a crafted `?save=` link triggers a navigation-time
  favorite once the target signs in — harm is minimal (favorites are private, idempotent, removable).
- Split into two issues (Round-2 fix): **F8a** = the `returnTo` validator + callback redirect (touches auth,
  `safe:human`, genuinely parallel — no favorites deps); **F8b** = the client auto-save reader that fires
  `favoriteListing` on return (depends on F2 + F4). Until F8a merges the dialog degrades to landing on `/`.

## 8. Trust model (ADR-007)

Favorites are a **personal/social** signal, structurally separated from the celiac-safety verdict. The
save-count is governed by the **same treatment ADR-007 already applies to `googleRating`**: an external/
non-verdict pill, attributed, colour + label (never colour-only), visually subordinate to and never
adjacent to `SafetySignal`. The heart conveys only the viewer's own save state. No safety meaning rests on
the heart or the count.

## 9. Testing

- **Unit (Vitest, co-located):** server fns — anon→401, over-limit→429, idempotent double-add, remove no-op,
  hidden/missing listing rejected by `addFavorite`, hidden excluded from `getViewerFavoriteIds`, count
  aggregate correctness, `savedOnly` honest pagination/total; `returnTo` validator accepts `/listings/x?save=y`
  and rejects `//evil.com`/`https://evil`/`/\evil`/`%2f%2fevil`/CRLF-injected.
- **Component (Testing Library):** FavoriteButton — anon click opens dialog & no write, optimistic toggle
  on/off, error rollback, `aria-pressed`+label flip; card renders the count pill distinctly from `SafetySignal`.
- **Regression (F3):** golden test asserting browse cards are byte-identical before/after the
  `buildBrowseCards` extraction (safety-critical path).
- **E2E (Playwright, `tests/e2e/` + `fixtures.ts` sealed-cookie sign-in):** favorite from a card → appears on
  `/favorites` → "Saved" filter shows only it (across pages) → unfavorite → drops; anon click → dialog, no write.
- Gate: `pnpm preflight` green; CI diff-coverage ≥80% on changed lines; hard-rules check passes.

## 10. Rollout / migration

`favorites` migration in F1 (`safe:human`); CI applies prod migration on merge to `main`. Dependency
ordering guarantees UI never ships before its table/server layer. F8 (auth) also `safe:human`. Everything
else `safe:agent`, mergeable behind green CI + the adversarial-review gate.

## 11. Risks & sharp edges

1. **Per-user state leaking via shared cache (SSR/hydration).** Separate cookie-resolved `["favorites"]`
   query; VM stays free of per-user state. The **SSR document HTML** carries the dehydrated `["favorites"]`
   snapshot, so the SSR response (not just the browse fn) must **never be CDN/edge-cached as public**.
2. **Moderation-hidden listing as a filled heart / on `/favorites`.** Both read paths INNER JOIN `listings`
   and filter `moderationStatus="visible"`; `addFavorite` refuses non-visible. Row persists (reappears if
   restored) — filtered at read, not deleted on moderation.
3. **`buildBrowseCards` extraction refactors the ADR-007 safety path.** Own issue (F3), golden regression
   test, extra review, distance logic kept out of the shared helper. Highest-risk change in the set.
4. **"Saved" filter vs pagination (Round-1 blocker, resolved).** Implemented server-side (`savedOnly`), not
   as a client-side page filter, so totals/pagination stay honest.
5. **Rate-limit on a toggle.** Add+remove share the 50/60s per-user budget; a 429 mid-mash rolls the
   optimistic state back with a toast. Acceptable v1 (dedicated bucket = possible future work).
6. **Optimistic races.** `cancelQueries` in `onMutate`, `disabled` while pending, reconcile in `onSettled`.
7. **Count-vs-safety confusion (ADR-007).** Count governed by the `googleRating` precedent; never near
   `SafetySignal`.
8. **OAuth `returnTo` open redirect + auto-save side-effect.** Hardened validator (§7); auto-save fires once
   for a validated visible listing and strips its marker; navigation-time favorite is an accepted, minimal
   risk.
9. **Anonymous prefetch cost.** Root-loader favorites prefetch short-circuits to `[]` for cookieless anon.
10. **`/favorites` unbounded query.** v1 loads the full set (small in practice); pagination is a noted
    follow-up if a heavy user emerges.

## 12. Alternatives considered

- **Augment browse payload with per-user `isFavorited`** — rejected: SSR/hydration leakage (§5, §11.1).
- **"Saved" as a client-side page filter** — rejected: under-counts across pagination (Round-1 blocker).
- **Toast instead of dialog for anon** — rejected per product decision (dialog is clearer/more deliberate).
- **Immediate redirect to Google on anon click** — rejected: jarring, destroys context.
- **Invalidate-on-success (uniform with votes)** — acceptable but laggier; optimistic chosen for instant feel.

---

## Appendix A — Linear issue decomposition (F1–F12)

| # | Title | Est | Gate | Depends | Notes |
| --- | --- | --- | --- | --- | --- |
| F1 | `feat(db): add favorites join table + migration` | S | **safe:human** | — | schema + generate/migrate |
| F2 | `feat(favorites): server write + read layer (add/remove/ids/counts)` | M | **safe:human** | F1 | auth+rate-limit gated writes; visible-only reads; count aggregate |
| F3 | `refactor(browse): extract server-only buildBrowseCards (+golden test)` | S | **safe:human** | F2 | **safety-critical** ADR-007 path — human-gated despite golden test; distance stays in getBrowseListings |
| F4 | `feat(favorites): client favorites-ids query + root prefetch` | S | safe:agent | F2 | `["favorites"]`, anon→[] |
| F5 | `feat(favorites): FavoriteButton island (optimistic + sign-in dialog)` | M | safe:agent | F4 | dialog degrades to `/` pre-F8 |
| F6 | `feat(listings): wire FavoriteButton into browse card + map` | S | safe:agent | F5 | VM per-user-free |
| F7 | `feat(listings): favorite heart on listing detail page` | S | safe:agent | F5 | |
| F8a | `feat(auth): returnTo validator + OAuth callback redirect` | S | **safe:human** | — (parallel) | hardened validator; httpOnly cookie; no favorites deps |
| F8b | `feat(favorites): auto-save pending favorite after sign-in` | S | safe:agent | F2, F4 | reads `?save=` marker, fires once, strips marker |
| F9 | `feat(favorites): /favorites route + page + nav link` | M | safe:agent | F3, F5 | reuse DirectoryList; count pill via getViewerFavorites |
| F10 | `feat(favorites): public save-count pill on cards (ADR-007-distinct)` | M | safe:agent | F2, F3 | threads count through VM/mapper |
| F11 | `feat(browse): server-side "Saved" filter (savedOnly) + directory control` | M | safe:agent | F2, F6 | honest pagination/total; savedOnly response is private/uncacheable |
| F12 | `test(e2e): favorite toggle, /favorites, saved-filter, anon dialog` | S | safe:agent | F6,F7,F9,F11 | |

**Ordering:** F1→F2→(F3,F4)→F5→(F6,F7,F9,F10)→F11→F12. F8a fully parallel; F8b joins after F2+F4. Each row =
one Worker subagent behind the 2-round adversarial review loop. The `safe:human` gates are F1, F2, F3, F8a
(schema/server/safety-path/auth); everything else is `safe:agent`.
