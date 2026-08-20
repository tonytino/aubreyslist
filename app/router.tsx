import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
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

  // routerWithQueryClient dehydrates loader-prefetched query data on the
  // server and hydrates it on the client — no manual hydration setup.
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
