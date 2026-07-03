# Favorites — Linear issues (ready to create under the Favorites project, team AUB)

All issues: state `Backlog`, project `Favorites`, plus a type label (`Feature`/`Improvement`) and the
`safe:*` gate noted. Estimates XS/S/M/L → 1/2/3/5. Full rationale lives in the project description (the spec).

---

## F1 — feat(db): add favorites join table + migration  · S · safe:human · deps: —
**Scope:** Add a `favorites` table to `db/schema.ts` mirroring `attestations` but create-or-delete (no
`updatedAt`): text-uuid `id`, `userId`+`listingId` FKs `onDelete:"cascade"` notNull, `createdAt`,
`unique("favorites_user_listing_unique")`, `favorites_user_idx`, `favorites_listing_idx`. Export
`Favorite`/`NewFavorite`. Run `pnpm db:generate`; commit the generated migration.
**Acceptance:** schema compiles; `pnpm db:generate` produces a clean migration; migration applies against a
fresh DB; `pnpm preflight` green. No app wiring yet.

## F2 — feat(favorites): server write + read layer (add/remove/ids/counts) · M · safe:human · deps: F1
**Scope:** `app/server/favorites/index.ts` + `favorites.fn.ts` copying the attestations 3-file split.
`addFavorite`/`removeFavorite` (each `requireCurrentUser()` → `enforceWriteLimit(user.id)` → drizzle;
`addFavorite` verifies listing exists + `moderationStatus="visible"`, `onConflictDoNothing`);
`getViewerFavoriteIds()` (anon→`[]`, visible-only INNER JOIN); `getFavoriteCounts(ids)`. Client-safe
`favoriteInputSchema` in `app/listings/favorite-input.ts`. Thin `createServerFn` wrappers.
**Acceptance:** unit tests — anon→401, over-limit→429, idempotent double-add, remove no-op,
hidden/missing listing rejected, hidden excluded from ids, count aggregate correct. No `db` reachable from
any client import. `pnpm preflight` green.

## F3 — refactor(browse): extract server-only buildBrowseCards (+golden test) · S · safe:human · deps: F2
**Scope:** Extract the "listings→cards" trust-glance tail of `app/server/listings/browse.ts` into a
server-only `buildBrowseCards(listings, now, months)` (owns only `getCeliacAggregatesByListing` +
`getRecentIncidentDatesByListing` + `deriveListingTrustGlance`). **Distance-label logic stays in
`getBrowseListings`.** `getBrowseListings` calls the helper; no behavior change.
**Acceptance (safety-critical, ADR-007):** golden regression test asserting browse cards are byte-identical
before/after; all existing browse tests green; `pnpm preflight` green. Human-gated merge.

## F4 — feat(favorites): client favorites-ids query + root prefetch · S · safe:agent · deps: F2
**Scope:** `app/favorites/favorites-query.ts` → `favoriteIdsQuery` (key `["favorites"]`, `queryFn`
`fetchViewerFavoriteIds`). Prefetch in `__root.tsx` loader via `ensureQueryData`.
**Acceptance:** anon SSR resolves to `[]` with no DB hit; signed-in resolves to the id set on first paint.
Component/loader test; `pnpm preflight` green.

## F5 — feat(favorites): FavoriteButton island (optimistic + sign-in dialog) · M · safe:agent · deps: F4
**Scope:** `app/components/listing/FavoriteButton.tsx`, props `{ listingId, listingName? }`. Reads
`favoriteIdsQuery` + `currentUserQuery`. Optimistic `useMutation` (`onMutate` cancel+snapshot+flip,
`onError` rollback+toast, `onSettled` invalidate). `aria-pressed`, label flip, `fill-current`+label (not
colour-only), `disabled` while pending. Anon click → Radix Dialog (`app/components/ui/dialog.tsx`) with
"Sign in" → `/api/auth/google?returnTo=<path with ?save= marker>`. No write while anon.
**Acceptance:** Testing-Library tests — anon click opens dialog & performs no write; signed-in optimistic
toggle on/off; error rollback; a11y attributes present. `pnpm preflight` green.

## F6 — feat(listings): wire FavoriteButton into browse card + map · S · safe:agent · deps: F5
**Scope:** Replace the dead heart in `ListingCard.tsx` (~L203-209) with `<FavoriteButton listingId={vm.id}
listingName={vm.name} />`. VM/mapper stay per-user-free. Confirm it works on both list and map-carousel surfaces.
**Acceptance:** heart toggles on browse list + map; card stays client-safe (no server import); `pnpm preflight` green.

## F7 — feat(listings): favorite heart on listing detail page · S · safe:agent · deps: F5
**Scope:** Add `<FavoriteButton>` to `app/routes/listings.$id.tsx` header/hero. Reflects prefetched state.
**Acceptance:** toggle persists + reflects `["favorites"]`; `pnpm preflight` green.

## F8a — feat(auth): returnTo validator + OAuth callback redirect · S · safe:human · deps: —
**Scope:** Extend `app/server/routes/auth.ts`: `/google` reads `returnTo`, validates **same-origin relative
only** (single leading `/`; reject `//`, `/\`, protocol-relative, absolute, CRLF, `%2f%2f`; `new URL(returnTo,
origin).origin === origin`; query strings allowed), stores in a short-lived httpOnly cookie beside
`al_oauth_state`/`al_oauth_verifier`; `/callback/google` redirects there (default `/`).
**Acceptance:** validator unit/fuzz tests reject `//evil.com`, `https://evil`, `/\evil`, `%2f%2fevil`,
CRLF-injected; accept `/listings/x?save=y`. Existing auth tests green; `pnpm preflight` green. Human-gated.

## F8b — feat(favorites): auto-save pending favorite after sign-in · S · safe:agent · deps: F2, F4
**Scope:** On return, client reads the `?save=<listingId>` marker, fires `favoriteListing` exactly once,
strips the marker via `replaceState`. Idempotent (unique constraint); server re-checks visible.
**Acceptance:** returning with `?save=` saves once + clears the marker; double-return doesn't double-write;
`pnpm preflight` green.

## F9 — feat(favorites): /favorites route + page + nav link · M · safe:agent · deps: F3, F5
**Scope:** `app/routes/favorites.tsx`. Loader prefetches `["viewer-favorites"]` (`getViewerFavorites`, which
attaches counts) + `favoriteIdsQuery`. States: anon → empty + sign-in link (`returnTo=/favorites`);
signed-in empty; signed-in populated (reuse `DirectoryList`/`RestaurantCard`). Nav/`UserMenu` link for
signed-in users.
**Acceptance:** three states render; cards (incl. count pill) match browse; route smoke test; `pnpm preflight` green.

## F10 — feat(favorites): public save-count pill on cards (ADR-007-distinct) · M · safe:agent · deps: F2, F3
**Scope:** Attach `getFavoriteCounts` in `getBrowseListings` (+ `getViewerFavorites`); thread the count
through `RestaurantCardVM` + `listingToCardVM`; render a small attributed pill governed by the `googleRating`
ADR-007 precedent — colour+label, subordinate, never adjacent to `SafetySignal`; hidden when zero.
**Acceptance:** count renders distinctly from the safety signal; component test asserts separation; no
server-only import reaches the client card; `pnpm preflight` green.

## F11 — feat(browse): server-side "Saved" filter (savedOnly) + directory control · M · safe:agent · deps: F2, F6
**Scope:** `getBrowseListings` gains a `savedOnly` mode → constrains to the signed-in viewer's visible
favorite ids **before** paginating (honest `page`/`total`/`hasMore`). The `savedOnly` response is
per-viewer/private — must Vary on session, never shared/edge-cached. Directory control (URL `?saved=1`),
sign-in-gated (opens the dialog when anon).
**Acceptance:** unit test — `savedOnly` pagination/total honest across pages; anon `savedOnly`→empty;
control gates on auth; `pnpm preflight` green.

## F12 — test(e2e): favorite toggle, /favorites, saved-filter, anon dialog · S · safe:agent · deps: F6,F7,F9,F11
**Scope:** Playwright (`tests/e2e/` + `fixtures.ts` sealed-cookie sign-in): signed-in favorite from a card →
appears on `/favorites` → "Saved" filter shows only it (across pages) → unfavorite → drops; anon click →
dialog, no write. Unique per-run identifiers; clean up created rows.
**Acceptance:** green in CI (migrations applied first); `pnpm preflight` typechecks the specs.

---

**Build order:** F1→F2→(F3,F4)→F5→(F6,F7,F9,F10)→F11→F12. F8a parallel; F8b after F2+F4.
**Human-gated merges:** F1, F2, F3, F8a. **Agent-mergeable (green CI):** F4,F5,F6,F7,F8b,F9,F10,F11,F12.
