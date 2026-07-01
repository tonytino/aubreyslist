import { createFileRoute } from "@tanstack/react-router";
import app from "../server/index";

// Catch-all Server Route: hand every method off to the Hono app, including
// OPTIONS (CORS preflight) and HEAD — otherwise those requests never reach Hono
// and fail at this layer.
//
// Since TanStack Start v1.120 (post-vinxi) there is no separate API router or
// `createStartAPIHandler`. A "Server Route" is an ordinary file-based route that
// declares a `server.handlers` map; the generated route tree wires it into the
// SSR handler, which dispatches `/api/*` to these handlers in both dev and the
// production (Nitro) build. Each handler receives `{ request, params, context }`.
const handler = ({ request }: { request: Request }) => app.fetch(request);

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
      OPTIONS: handler,
      HEAD: handler,
    },
  },
});
