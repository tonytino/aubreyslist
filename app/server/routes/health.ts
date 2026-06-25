import { Hono } from "hono";

// Liveness probe — useful for uptime checks, load balancers, and deploy smoke
// tests. No dependencies and no DB access; always returns 200.
export const healthRoutes = new Hono().get("/", (c) => c.json({ status: "ok" }));
