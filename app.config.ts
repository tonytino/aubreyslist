import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "@tanstack/react-start/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  tsr: {
    appDirectory: "app",
  },
  // Target Vercel via the Nitro/Vinxi deployment preset so the build emits the
  // Vercel Build Output API output (`.vercel/output`) instead of generic Vinxi
  // output. This is the ONLY platform-specific bit — keep it that way so a
  // future Cloudflare port is a single preset swap (ADR-009).
  server: {
    preset: "vercel",
  },
  vite: {
    plugins: [tailwindcss(), tsconfigPaths()],
  },
});
