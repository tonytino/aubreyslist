import tailwindcss from "@tailwindcss/vite";
import { nitroV2Plugin } from "@tanstack/nitro-v2-vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Keep the dev server on :3000 (Vite defaults to :5173). The Playwright config
  // (`webServer.url`/`baseURL`) and the prod Nitro server (`node
  // .output/server/index.mjs`, also :3000) both assume :3000, so pinning it here
  // keeps `pnpm dev`, the E2E harness, and `pnpm start` on one port.
  server: { port: 3000 },
  plugins: [
    // Resolve the `~/*` and `~/db/*` path aliases from tsconfig.json everywhere
    // (SSR, client, and the server build) — must come before the framework
    // plugins so they see resolved imports.
    tsconfigPaths(),
    // Tailwind v4 Oxide engine, consumed via `@import "tailwindcss"` in
    // app/styles/app.css.
    tailwindcss(),
    // TanStack Start (post-vinxi: a Vite plugin since v1.120). It auto-wires the
    // router manifest and the client/SSR entries, so app/ssr.tsx collapses to the
    // framework default handler (createStartHandler(defaultStreamHandler)). Our
    // app code lives in app/ (the plugin defaults to src/), so point it there.
    // File-based API routes are ordinary routes now: a route file that exports a
    // `server.handlers` map (app/routes/api.$.ts) is generated into the route
    // tree automatically — there is no separate API-router toggle to set.
    tanstackStart({ srcDirectory: "app" }),
    // React Fast Refresh / JSX transform. TanStack Start no longer bundles this;
    // it must be registered after tanstackStart() per the plugin's ordering.
    viteReact(),
    // Nitro v2 build target. This replaces vinxi's Nitro integration and emits
    // the Node server at .output/server/index.mjs (what `pnpm start` runs and
    // what the CI build-smoke gate probes). On Vercel (which injects `VERCEL=1`)
    // we switch Nitro to the Vercel preset so the build produces the Vercel Build
    // Output API output; everywhere else (local, CI) Nitro stays on its default
    // node-server preset. This is the ONLY platform-specific bit — a future
    // Cloudflare port is a single preset swap (ADR-009).
    //
    // `VERCEL` is a non-secret platform build flag and vite.config.ts is
    // build-time tooling (never shipped to the client), so reading it here does
    // not breach the "no process.env outside app/env.ts" rule, which governs app
    // runtime code and secrets. See docs/agents/environment.md.
    nitroV2Plugin(process.env.VERCEL ? { preset: "vercel" } : undefined),
  ],
});
