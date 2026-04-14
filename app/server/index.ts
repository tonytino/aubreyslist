import { Hono } from "hono";
import { exampleRoutes } from "./routes/example";

// All API routes are mounted under /api
// This app is handed off from TanStack Start's catch-all API route
const app = new Hono().basePath("/api");

// Mount route groups here
app.route("/example", exampleRoutes);

// Typed RPC export — import this in the frontend for full type safety
// Usage: const client = hc<AppType>("/")
export type AppType = typeof app;

export default app;
