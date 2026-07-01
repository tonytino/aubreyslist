# API Layer

This repo uses two complementary backend patterns. Choosing correctly matters.

## Decision Rule

**Ask: could anything outside this app's frontend ever need this data?**

| Question                                                        | Answer | Use                  |
| --------------------------------------------------------------- | ------ | -------------------- |
| Is this data consumed only by the route/component that loads it? | Yes    | Server function      |
| Will a webhook, mobile app, cron job, or third party call this? | Yes    | Hono route           |
| Does it need to be RESTful / independently testable via curl?    | Yes    | Hono route           |
| Not sure yet?                                                    | —      | Start with Hono route (easier to consume later) |

Server functions and Hono routes are *how* data is produced. **TanStack Query**
is *how the client caches, shares, and refetches it.* They compose:

- **Plain server function in a loader** (e.g. `getWelcome`) — one-shot route data
  you don't need to cache, dedupe, or refetch. Simplest; no Query involved.
- **TanStack Query** — data you want cached across components/navigations,
  refetched on demand, or kept fresh (`staleTime`, invalidation, mutations).
  The `queryFn` can be a server function, so you keep the no-fetch ergonomics.

Query is wired SSR-aware (see `app/router.tsx` — `routerWithQueryClient` + a
`QueryClient` in router context). Prefetch in a loader so data is dehydrated into
the HTML and hydrated on the client with no loading flash:

```ts
const itemsQuery = queryOptions({ queryKey: ["items"], queryFn: () => getItems() });

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(itemsQuery); // server prefetch
  },
  component: () => {
    const { data } = useSuspenseQuery(itemsQuery); // reads hydrated cache
    // ...
  },
});
```

`app/routes/index.tsx` is the live example (it uses both `getWelcome` and a
prefetched `itemsQuery` side by side).

## Layer 1 — Server Functions

For data tightly coupled to a single route or component.  Server functions run
only on the server but are called like normal async functions from loaders or
components — no endpoint URL, no fetch, no client wiring needed.

### Live example

`app/routes/index.tsx` contains a working server function (`getWelcome`).  Refer
to it as the canonical pattern.

### Minimal pattern

```ts
// Inside a route file
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const getData = createServerFn().handler(async () => {
  // Server-only code (DB access, secrets, etc.) is safe here
  return await db.select().from(myTable);
});

export const Route = createFileRoute("/my-route")({
  loader: () => getData(),
  component: MyComponent,
});

function MyComponent() {
  const data = Route.useLoaderData();
  return <div>{JSON.stringify(data)}</div>;
}
```

### When to validate inputs

If the server function accepts user-supplied arguments, validate with Zod:

```ts
import { z } from "zod";

const getItem = createServerFn()
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data: { id } }) => {
    return await db.select().from(items).where(eq(items.id, id));
  });
```

## Layer 2 — Hono Routes

For portable endpoints: webhooks, CRUD, anything consumable outside this frontend.

### Live example

The app mounts a `GET /api/health` liveness route
(`app/server/routes/health.ts`). For the canonical route-group pattern, see
**Adding a new Hono route group** below.

> **Request validation:** `@hono/zod-validator` is not a dependency yet — the
> example that demonstrated it was removed for a clean base. Add it
> (`pnpm add @hono/zod-validator`) when you build the first endpoint that takes
> a request body. It remains the standard validator for this layer: it is used
> in the snippet below and required by the "Do Not" rules at the bottom of this
> doc.

### Adding a new Hono route group

1. Create `app/server/routes/your-resource.ts`
2. Define a `new Hono()` chain and export it
3. Mount it in `app/server/index.ts` with `app.route("/your-resource", yourRoutes)`

```ts
// app/server/routes/your-resource.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const yourResourceRoutes = new Hono()
  .get("/", (c) => c.json({ items: [] }))
  .post("/", zValidator("json", z.object({ name: z.string() })), (c) => {
    const { name } = c.req.valid("json");
    return c.json({ name }, 201);
  });
```

Always validate request bodies with `zValidator` from `@hono/zod-validator`.

## Errors and Not Found

The Hono app (`app/server/index.ts`) centralizes both:

- Unmatched routes return JSON `{ "error": "Not Found" }` with status 404.
- Unhandled exceptions are logged and return `{ "error": "Internal Server Error" }` with status 500 — no stack traces leak.

To return a specific status from a route, throw an `HTTPException` (it is passed through verbatim) rather than crafting an ad-hoc error response:

```ts
import { HTTPException } from "hono/http-exception";

if (!item) throw new HTTPException(404, { message: "Item not found" });
```

The catch-all in `app/routes/api.$.ts` forwards every method — including `OPTIONS` (CORS preflight) and `HEAD` — to Hono, so add CORS middleware there if you need it. It is a TanStack Start **Server Route** (`createFileRoute("/api/$")({ server: { handlers: { GET, POST, … } } })`, each handler calling `app.fetch(request)`) — the post-vinxi replacement for the old `createAPIFileRoute` / `app/api.ts` router (ADR-012).

## RPC Client — Frontend Consuming Hono

Never use raw `fetch` against Hono routes from the frontend. Use the typed RPC client:

```ts
import { hc } from "hono/client";
import type { AppType } from "~/server/index";

const client = hc<AppType>("/");

// Fully typed — knows the shape of every route
const res = await client.api["your-resource"].$get();
const data = await res.json();
```

## Do Not

- Do not modify `app/routes/api.$.ts` — it is the generic Hono handoff.
- Do not call `db` from client-side code. DB access is server-only.
- Do not skip `zValidator` on POST/PUT/PATCH handlers.
