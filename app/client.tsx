import "./instrument.client";
import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

// Client entry. Since TanStack Start v1.120 (post-vinxi) StartClient takes no
// props — it internally runs hydrateStart(), which imports `getRouter` from
// app/router.tsx (the `#tanstack-router-entry` virtual module) and hydrates the
// SSR'd HTML. Without this entry running, the app ships as a no-JS site (the CI
// build-smoke gate asserts the `<script type="module">` client bundle resolves).
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>
  );
});
