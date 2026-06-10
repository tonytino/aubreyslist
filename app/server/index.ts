import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { exampleRoutes } from "./routes/example";

// All API routes are mounted under /api
// This app is handed off from TanStack Start's catch-all API route
const app = new Hono().basePath("/api");

// Mount route groups here
app.route("/example", exampleRoutes);

// Consistent JSON for unmatched routes instead of Hono's default text 404.
app.notFound((c) => c.json({ error: "Not Found" }, 404));

// Centralized error handling. Honor intentional HTTPExceptions; otherwise log
// and return a generic 500 without leaking internals (e.g. stack traces).
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

// Typed RPC export — import this in the frontend for full type safety
// Usage: const client = hc<AppType>("/")
export type AppType = typeof app;

export default app;
