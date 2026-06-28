import { createStartAPIHandler, defaultAPIFileRouteHandler } from "@tanstack/react-start/api";

// API router entry point. TanStack Start's config (`@tanstack/react-start-config`)
// only registers the Vinxi "api" router — the one that serves `/api/*` in the
// production build — when this file exists (it gates on `existsSync(app/api.ts)`).
// Without it, `/api/*` falls through to the SSR router and renders the 404 HTML
// page instead of reaching our file-based API route (`app/routes/api.$.ts`),
// which forwards every request to the Hono app (`app/server/index.ts`).
//
// `defaultAPIFileRouteHandler` matches the incoming request against the
// generated file-based API routes and dispatches to their exported `APIRoute`.
export default createStartAPIHandler(defaultAPIFileRouteHandler);
