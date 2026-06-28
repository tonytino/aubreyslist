import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";

// All API routes are mounted under /api
// This app is handed off from TanStack Start's catch-all API route
const app = new Hono().basePath("/api");

// Health check — a useful liveness probe. Keep it.
app.route("/health", healthRoutes);

// Google OAuth sign-in/out + session (ADR-006). Callback lives at the
// human-provisioned path /api/auth/callback/google.
app.route("/auth", authRoutes);

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
