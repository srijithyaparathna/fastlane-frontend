// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Served in production behind nginx, which proxies the public domain to this
// dev server — Vite's default host check would otherwise 403 that Host header.
export default defineConfig({
  vite: {
    server: {
      allowedHosts: ["pre-consensus-attestation-pallet-fastlane.projectfreedom.io"],
    },
  },
});
