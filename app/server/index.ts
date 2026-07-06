import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { placesRoutes } from "./routes/places";
import { honoSecurityHeaders } from "./security/headers";
import { honoOriginCheck } from "./security/origin";

// All API routes are mounted under /api
// This app is handed off from TanStack Start's catch-all API route
const app = new Hono().basePath("/api");

// Security response headers on every /api response (AUB-162). Mounted FIRST so
// it wraps all downstream handlers and stamps headers even on error/404
// responses. Same header set is applied to SSR/document responses in
// `app/start.ts` — see `app/server/security/headers.ts`.
app.use("*", honoSecurityHeaders());

// CSRF defense-in-depth (AUB-174): reject state-changing cross-origin requests
// with 403 BEFORE any route/DB work. Central here for /api mutations; the
// server-function surface is guarded in `app/start.ts`. See
// `app/server/security/origin.ts`.
app.use("*", honoOriginCheck());

// Health check — a useful liveness probe. Keep it.
app.route("/health", healthRoutes);

// Google OAuth sign-in/out + session (ADR-006). Callback lives at the
// human-provisioned path /api/auth/callback/google.
app.route("/auth", authRoutes);

// Google Place photo media proxy (AUB-215, ADR-014) — resolves a transient
// photo token to Google's short-lived media URL server-side and 302s to it.
app.route("/places", placesRoutes);

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
