// Custom SSR request-handler entry (AUB-110).
//
// Previously this app had no explicit server entry — TanStack Start's Vite
// plugin supplied the framework default. We now define one so we can wrap the
// request handler with Sentry, which adds tracing/error capture around every
// server-side fetch (SSR renders, API routes, server functions).
//
// `@tanstack/react-start/server-entry` gives us the default `handler` (the
// framework's fetch implementation) plus `createServerEntry`, the helper that
// registers our (possibly wrapped) handler as THE server entry. Sentry's
// `wrapFetchWithSentry` decorates that fetch with instrumentation; the shape
// mirrors Sentry's documented `server.ts` example, adapted to this repo's
// `app/` source directory.
import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import handler, { createServerEntry, type ServerEntry } from "@tanstack/react-start/server-entry";

const requestHandler: ServerEntry = wrapFetchWithSentry({
  fetch(request: Request) {
    return handler.fetch(request);
  },
});

export default createServerEntry(requestHandler);
