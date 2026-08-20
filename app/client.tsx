import "./instrument.client";
import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

// Client entry. StartClient takes no props: it runs hydrateStart(), which
// imports `getRouter` from app/router.tsx (the `#tanstack-router-entry`
// virtual module) and hydrates the SSR'd HTML. Without this entry the app
// ships as a no-JS site (CI's build-smoke gate asserts the client bundle
// resolves).
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>
  );
});
