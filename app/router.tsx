import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

// TanStack Start's Vite plugin imports `getRouter` from this file via the
// `#tanstack-router-entry` virtual module; client hydration and the SSR
// handler both call it. The name and signature are the framework contract —
// do not rename.
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // A small non-zero staleTime keeps `defaultPreload: "intent"` from
      // refetching immediately on navigation.
      queries: { staleTime: 60_000 },
    },
  });

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  // Dehydrates loader-prefetched query data on the server, hydrates it on the
  // client, and wraps the router in a QueryClientProvider.
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
