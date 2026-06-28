import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "@tanstack/react-start/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  tsr: {
    appDirectory: "app",
    // Generate the file-based API routes (e.g. app/routes/api.$.ts) so the API
    // router's handler has routes to dispatch to. Paired with app/api.ts, which
    // is what makes the config register the Vinxi "api" router that serves
    // /api/* in the production build. Both are required: without this flag the
    // route is never generated; without app/api.ts the router is never built.
    __enableAPIRoutesGeneration: true,
  },
  // Target Vercel via the Nitro/Vinxi deployment preset ONLY when building on
  // Vercel (which injects `VERCEL=1`). There the build emits the Vercel Build
  // Output API output (`.vercel/output`); everywhere else (local dev, CI) the
  // preset stays unset so Nitro produces the default node server (`.output/`),
  // keeping `pnpm build && pnpm start` and the CI production-build smoke working.
  // This is the ONLY platform-specific bit — a future Cloudflare port is a
  // single preset swap (ADR-009).
  //
  // `VERCEL` is a non-secret platform build flag and app.config.ts is build-time
  // tooling (never shipped to the client), so reading it here does not breach the
  // "no process.env outside app/env.ts" rule, which governs app runtime code and
  // secrets. See docs/agents/environment.md.
  server: {
    preset: process.env.VERCEL ? "vercel" : undefined,
  },
  vite: {
    plugins: [tailwindcss(), tsconfigPaths()],
  },
});
