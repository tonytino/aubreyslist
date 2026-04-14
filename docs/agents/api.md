# API Layer

This repo uses two complementary backend patterns. Choosing correctly matters.

## Decision Rule

**Ask: could anything outside this app's frontend ever need this data?**

- No → use a TanStack Start server function
- Yes (or unsure) → use a Hono route

## Layer 1 — Server Functions

For data tightly coupled to a single route or component.

```ts
// Inside a route file
const getData = createServerFn().handler(async () => {
  return await db.select().from(myTable);
});

export const Route = createFileRoute("/my-route")({
  loader: () => getData(),
  component: MyComponent,
});
```

## Layer 2 — Hono Routes

For portable endpoints: webhooks, CRUD, anything consumable outside this frontend.

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
