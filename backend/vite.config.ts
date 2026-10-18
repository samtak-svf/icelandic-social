import { cloudflare } from "@cloudflare/vite-plugin";
import { web } from "spjall-web/build";
import { defineConfig } from "vite";

// How `cf dev` and `cf build` build the Worker: Vite with the Cloudflare
// plugin, which reads cloudflare.config.ts, and the web app's plugins after
// it, bound to the Worker's SSR environment (decision 0062). The plugin must
// come first. The dev server keeps the port the apps and the interop test
// expect (AGENTS.md § Commands), on IPv4 like the fake Kenni's issuer.
//
// package.json lists react, react-dom and @tanstack/react-router although
// only web/ imports them: Vite's dependency optimizer resolves the SSR
// environment's packages from this directory, and without them `cf dev` loads
// React's CommonJS unbundled and the Worker fails to start.
export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), web()],
  server: { host: "127.0.0.1", port: 8787, strictPort: true },
});
