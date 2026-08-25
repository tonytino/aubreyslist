# URL / query-param state

**Decision rule:** if a piece of UI state is *shareable or should survive a
refresh / back-forward / a pasted link*, it belongs in the URL as a validated
search param — never in route-level `useState`. If it is *genuinely ephemeral*,
keep it in `useState`.

| Belongs in the URL (`?param=`)                          | Stays ephemeral (`useState`)                     |
| ------------------------------------------------------- | ------------------------------------------------ |
| Filters, sort, page, free-text search, selected tab, a distance/radius, a "quick" preset, the map's selected pin (`?sel=`) and loaded-pages count (`?pages=`) | Toasts (`sonner`), loading shimmers, transient hover/focus, an open/closed menu or sheet |

This is a **Hard Rule** (see `AGENTS.md`), enforced by the **conventions**
lens (URL-state hygiene) of the specialist review panel
(`docs/agents/orchestration.md`) — not a static CI check, since the property is
not statically decidable.

The canonical implementation is the directory route (`app/routes/index.tsx` +
`app/listings/browse-search.ts` + `app/server/listings/*`). Copy its shape.

## How to put state in the URL

1. **Validate it.** Define one Zod schema and hand it to the route's
   `validateSearch`, so a missing/garbage param degrades instead of throwing.
   Keep the schema in a shared `app/listings/*.ts`-style module — not exported
   from the route file, so `tsr generate` never reasons about a non-route
   export. Example: `browseSearchSchema` in `app/listings/browse-search.ts`.

2. **Single-source the defaults + strip them from the URL.** Every param with a
   default goes in ONE `*_DEFAULTS` map, referenced by both the schema's
   `.catch()/.default()` AND a `stripSearchParams(...)` search middleware on the
   route, so default-valued params never appear in the bar. Assert
   `DEFAULTS === schema.parse({})` in a unit test so the two can't drift.
   Example: `BROWSE_SEARCH_DEFAULTS` +
   `search: { middlewares: [stripSearchParams(...)] }`. A param with **no**
   default (e.g. `?quick=`, `z.enum(...).optional()`) is naturally absent when
   unset and needs no strip entry.

   ```ts
   export const Route = createFileRoute("/")({
     validateSearch: browseSearchSchema,
     search: { middlewares: [stripSearchParams(BROWSE_SEARCH_DEFAULTS)] },
     // ...
   });
   ```

3. **Read it, don't mirror it.** Derive the value straight from
   `Route.useSearch()` (e.g. `const quick = quickParam ?? null`). Do **not**
   copy it into `useState` — deriving from the URL makes
   refresh/back-forward/share correct by construction and avoids SSR-vs-client
   seeding divergence.

4. **Write it with the functional updater.** Use
   `navigate({ search: (prev) => ({ ...prev, ...changes }) })` so every other
   param carries forward. Avoid the object form `{ search: { ...all keys } }` —
   it re-lists (and can silently drop) every param, and re-serializes defaults.

5. **Reset `page` iff the result SET changed.** A param that changes what the
   server returns (filter, sort, search, radius, a server-side quick filter)
   must reset `page: 1` in the same `navigate`. A param that only reorders or is
   client-only must NOT reset page.

6. **`loaderDeps` = server inputs only.** Add a param to `loaderDeps` (and the
   query key) **only** if it changes the server response. A purely client-side
   param in `loaderDeps` triggers spurious refetches. Example: the directory's
   `?view=` list/map toggle is validated and default-stripped like the rest but
   excluded from `loaderDeps` (see `view`/`setView` in `app/routes/index.tsx`).

## The one exception: the debounced search mirror

Free-text search (`?q=`) IS backed by a local `useState` mirror + a reconcile
effect (`app/routes/index.tsx`). That is the **only** sanctioned route-level
`useState`-from-a-param: typing must feel instant and be debounced before it
hits the URL, and the mirror reconciles when `?q=` changes from a link /
back-forward / clear-all. A discrete control (a chip, a `<select>`, a pagination
link) has no such need — navigate directly; do not add a mirror.

## Sensitive inputs: neither the URL nor storage

Some state drives the query without being a view worth sharing. The visitor's
coordinates are the case to copy (`app/routes/index.tsx`): they live in route
`useState` for the life of the tab, are rounded (`coarsenCoords`) before they
leave the browser, and travel only as server-function arguments.

Decide with one question: **would you be comfortable seeing this value in a
pasted link?** A sort token, yes. A filter, yes. Someone's position, no — in
the URL it rides into history, referrer headers, screenshots, and any link they
share.

Keeping it out of the URL costs the SSR pass, which has no reading yet. Cover
that on the server instead: the browse handler anchors the distance sort on the
request's coarse IP location (`app/server/listings/request-geo.ts`), and
degrades to a location-free sort when it has neither. The client refetches with
the real reading once the browser answers, inside a `startTransition` so
`useSuspenseQuery` swaps the results without dropping to a fallback.

Report what actually happened. The browse response carries `effectiveSort` and
`locationSource` so the page can say it fell back, rather than showing one
order under another order's name.

The line is *who chose the point*. The visitor's own reading — even coarsened
— is a position, so it never enters the URL. A map center the visitor
deliberately framed and then asked to search (`searchArea` in
`app/routes/index.tsx`, the map's "Search near here") is a chosen view of the
directory: it may ride in the URL (`?areaLat=`/`?areaLng=`), coarsened on
write, and only ever written behind an explicit camera gesture — never
inferred from where the visitor happens to be.

## Device preferences: `localStorage`

A *per-device preference* that is not sensitive belongs in `localStorage` —
the theme toggle (`app/components/ThemeToggle.tsx`) is the example. Guard every
access (`try`/`catch`): storage throws in some privacy modes, and a preference
that cannot be read is just an unset preference. Store the smallest flag that
works, never the underlying data.

## Reusable helpers

- `app/listings/browse-search.ts` — `browseSearchSchema`, `BROWSE_SEARCH_DEFAULTS`.
- `app/listings/browse-params.ts` — `parseAttrs` / `serializeAttrs`, `coordsFromSearch`.
- `app/listings/sort.ts`, `app/listings/distance.ts`, `app/listings/quick.ts` —
  the param vocabularies + `DEFAULT_*` constants (import these; never hardcode
  `"alpha"` / `25`).
- `stripSearchParams` / `retainSearchParams` — from `@tanstack/react-router`
  (no new dependency).

## Client-only params: don't scroll-jump on write

TanStack Router resets scroll to top on every `navigate()` by default. For a
param that changes the SERVER result set, that reset is usually correct. But a
client-only, view-only param (canonical example: the listing detail page's
`?tab=`, `app/routes/listings.$id.tsx`) changes no data — rewriting it must
never move the viewport, especially when the control sits below the fold. Pass
`resetScroll: false` on that `navigate()`:

```ts
navigate({
  search: (prev) => ({ ...prev, tab: value }),
  resetScroll: false,
});
```

Don't blanket-apply this — a control at the very top of the page has no
scroll-jump to fix, and a param that DOES change the result set generally wants
the default reset. Judge per call site.

The directory map's `?sel=` (selected pin) and `?pages=` (loaded-pages count)
are the high-frequency case of this class: a chosen view of the directory —
shareable, and restored by Back after visiting a listing — but written on
every pin/card tap and every "Load more". Both write with `replace: true` +
`resetScroll: false` (`app/routes/index.tsx`), so a tap trail never pollutes
history and the page never jumps. Because they describe cards of the current
result set, every navigation that changes the set strips them in the same
`navigate` — the route's `resultSetSearch` updater is the one seam
(`MAP_VIEW_PARAMS_CLEARED` in `app/listings/browse-search.ts`).

One sanctioned exception to that strip: the visitor's own reading arriving
for the "near me" anchor changes the result set with **no** navigation, and
deliberately keeps both params — the accumulation refetches under the new
anchor, and the selection survives when its listing is still shown. The
stale-`?sel=` judgement waits for the anchor to settle
(`isBrowseAnchorPending`) so a transient pre-reading set can never destroy a
restore that succeeds moments later.
