# URL / query-param state

**Decision rule:** if a piece of UI state is *shareable or should survive a
refresh / back-forward / a pasted link*, it belongs in the URL as a validated
search param — never in route-level `useState`. If it is *genuinely ephemeral*,
keep it in `useState`.

| Belongs in the URL (`?param=`)                          | Stays ephemeral (`useState`)                     |
| ------------------------------------------------------- | ------------------------------------------------ |
| Filters, sort, page, free-text search, selected tab, a distance/radius, a "quick" preset | Toasts (`sonner`), loading shimmers, transient hover/focus, an open/closed menu or sheet, the map's selected pin |

This is a **Hard Rule** (see `AGENTS.md`). It is enforced by the **"URL-state
hygiene" dimension** of the adversarial review loop
(`docs/agents/orchestration.md`), not a static CI check — full "detect ephemeral
state that should be a URL param" is not statically decidable, and the one
tractable check (a `useState` seeded from a param) would false-positive the
legitimate debounced-search mirror below. So this is a forcing function + an
auditable review record, in the same spirit as the review gate's own honesty
note — not cryptographic proof.

The canonical implementation is the directory route (`app/routes/index.tsx` +
`app/listings/browse-search.ts` + `app/server/listings/*`). Copy its shape.

## How to put state in the URL

1. **Validate it.** Define one Zod schema and hand it to the route's
   `validateSearch`, so a missing/garbage param degrades instead of throwing.
   Keep the schema in a shared `app/listings/*.ts`-style module (not exported
   from the route file, so `tsr generate` never reasons about a non-route
   export). Example: `browseSearchSchema` in `app/listings/browse-search.ts`.

2. **Single-source the defaults + strip them from the URL.** Every param that
   has a default goes in ONE `*_DEFAULTS` map, referenced by both the schema's
   `.catch()/.default()` AND a `stripSearchParams(...)` search middleware on the
   route, so params equal to their default never appear in the bar (a bare page
   reads as a clean `/`). The two must not drift — assert
   `DEFAULTS === schema.parse({})` in a unit test. Example:
   `BROWSE_SEARCH_DEFAULTS` + `search: { middlewares: [stripSearchParams(...)] }`.
   A param with **no** default (e.g. `?quick=`, `z.enum(...).optional()`) is
   naturally absent when unset and needs no strip entry.

   ```ts
   export const Route = createFileRoute("/")({
     validateSearch: browseSearchSchema,
     search: { middlewares: [stripSearchParams(BROWSE_SEARCH_DEFAULTS)] },
     // ...
   });
   ```

3. **Read it, don't mirror it.** Derive the value straight from
   `Route.useSearch()` (e.g. `const quick = quickParam ?? null`). Do **not** copy
   it into `useState` — deriving from the URL makes refresh/back-forward/share
   correct by construction and avoids SSR-vs-client seeding divergence.

4. **Write it with the functional updater.** Use
   `navigate({ search: (prev) => ({ ...prev, ...changes }) })` so every other
   param is carried forward and you only touch what changed. Avoid the object
   form `{ search: { ...all keys } }` — it re-lists (and can silently drop) every
   param, and re-serializes defaults.

5. **Reset `page` iff the result SET changed.** A param that changes what the
   server returns (filter, sort, search, radius, a server-side quick filter)
   must reset `page: 1` in the same `navigate` — a page index is meaningless
   under a new result set. A param that only reorders or is client-only must
   NOT reset page.

6. **`loaderDeps` = server inputs only.** Add a param to `loaderDeps` (and the
   query key) **only** if it changes the server response. A purely client-side
   param in `loaderDeps` triggers spurious refetches.

## The one exception: the debounced search mirror

Free-text search (`?q=`) IS backed by a local `useState` mirror + a reconcile
effect (`app/routes/index.tsx`). That is deliberate and the **only** sanctioned
route-level `useState`-from-a-param: typing must feel instant and be debounced
before it hits the URL, and the mirror reconciles when `?q=` changes from a link
/ back-forward / clear-all. A discrete control (a chip, a `<select>`, a
pagination link) has no such need — navigate directly; do not add a mirror.

## Reusable helpers

- `app/listings/browse-search.ts` — `browseSearchSchema`, `BROWSE_SEARCH_DEFAULTS`.
- `app/listings/browse-params.ts` — `parseAttrs` / `serializeAttrs`, `coordsFromSearch`.
- `app/listings/sort.ts`, `app/listings/distance.ts`, `app/listings/quick.ts` —
  the param vocabularies + `DEFAULT_*` constants (import these; never hardcode
  `"alpha"` / `25`).
- `stripSearchParams` / `retainSearchParams` — from `@tanstack/react-router`
  (no new dependency; TanStack-native).

## Client-only params: don't scroll-jump on write

TanStack Router resets scroll to top on every `navigate()` by default. For a
param that changes the SERVER result set (a filter, sort, search, radius, page),
that reset is usually correct — the visitor should land at the top of the new
results. But a client-only, view-only param (the canonical example: the listing
detail page's `?tab=`, `app/routes/listings.$id.tsx`) changes no data — rewriting
it should never move the viewport at all, especially when the control that
writes it sits below the fold (an evidence tab strip far down a long page). Pass
`resetScroll: false` on that `navigate()` call so flipping the param never
scroll-jumps:

```ts
navigate({
  search: (prev) => ({ ...prev, tab: value }),
  resetScroll: false,
});
```

Don't blanket-apply this — a control at the very top of the page (the browse
route's filter chip row) has no scroll-jump to fix either way, and a param that
DOES change the result set generally wants the default top-of-results reset. Use
judgment per call site, the same way you'd judge any other UX default.

## Resolved follow-up

The directory's list/map **view toggle** used to be `useState`. It has since
moved to `?view=` (`app/listings/browse-search.ts`'s `browseSearchSchema`,
consumed by `app/routes/index.tsx`) — a validated, `stripSearchParams`-defaulted
param like the rest, deliberately excluded from `loaderDeps` since it's
client-only (changes no server query). See the comments on `view`/`setView` in
`app/routes/index.tsx` for the owner-override context (AUB-164/AUB-111).
