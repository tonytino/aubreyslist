import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { routeTree } from "./routeTree.gen";

// TanStack Start's Vite plugin (post-vinxi) auto-imports `getRouter` from this
// file via the `#tanstack-router-entry` virtual module — both the client
// hydration path (hydrateStart) and the SSR handler call it. The name and
// signature are the framework contract; do not rename to `createRouter`.
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // A small non-zero staleTime keeps `defaultPreload: "intent"` from
      // refetching immediately on navigation.
      queries: { staleTime: 60_000 },
    },
  });

  // routerWithQueryClient wires the QueryClient into the router so query data
  // prefetched in a route loader (via context.queryClient) is dehydrated on the
  // server and hydrated on the client automatically — no manual hydration setup.
  return routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      context: { queryClient },
      defaultPreload: "intent",
      defaultPreloadStaleTime: 0,
      Wrap: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    }),
    queryClient
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
