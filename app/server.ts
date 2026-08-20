// Custom SSR request-handler entry: wraps the framework's default fetch
// handler with Sentry so every server-side fetch (SSR renders, API routes,
// server functions) gets tracing and error capture. `createServerEntry`
// registers the wrapped handler as the server entry; the shape mirrors
// Sentry's documented TanStack Start `server.ts` example.
import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import handler, { createServerEntry, type ServerEntry } from "@tanstack/react-start/server-entry";

const requestHandler: ServerEntry = wrapFetchWithSentry({
  fetch(request: Request) {
    return handler.fetch(request);
  },
});

export default createServerEntry(requestHandler);
