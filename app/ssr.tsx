// getRouterManifest is what surfaces the built client-entry asset — the
// `<script type="module">` that runs app/client.tsx's hydrateRoot. Without
// passing it to createStartHandler, router.ssr.manifest is undefined, the
// `<Scripts/>` in __root.tsx emits no client entry, and the app never hydrates
// (voting, the add-listing form, filter/sort, and SPA <Link> nav are all inert
// — users get a no-JS site). See the PR/issue for the regression this fixes.
import { getRouterManifest } from "@tanstack/react-start/router-manifest";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { createRouter } from "./router";

export default createStartHandler({
  createRouter,
  getRouterManifest,
})(defaultStreamHandler);
