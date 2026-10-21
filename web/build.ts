import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, PluginOption } from "vite";

/**
 * The web app's Vite plugins, after `cloudflare()` in backend/vite.config.ts,
 * which builds the one Worker that serves the API and this app. The order is
 * Start's: Start, then React, then the React Compiler after it.
 */
export function web(): PluginOption[] {
  return [
    tailwindcss(),
    // Start reads its source directory relative to the Vite root, backend/.
    tanstackStart({
      srcDirectory: relative(process.cwd(), fileURLToPath(new URL("./src", import.meta.url))),
    }),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
    preloadClosure(),
  ];
}

/**
 * Lists every client chunk's static imports transitively, so each page's
 * modulepreload links name every module it loads.
 *
 * Start writes a route's preloads as its chunk and that chunk's `imports`, one
 * level deep (start-plugin-core, manifestBuilder `getChunkPreloads`). A module
 * two levels down was fetched only once the module above it had arrived and
 * been parsed: one more round trip before the app ran, 570 ms on a Slow 4G
 * phone profile. Start reads the client bundle in a `post` generateBundle
 * hook; this one runs before it. Vite's own preload helper already follows
 * imports transitively, so the longer lists change nothing else.
 * `tooling/preload-check.mjs` checks the built manifest.
 */
function preloadClosure(): Plugin {
  return {
    name: "spjall:preload-closure",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle(_options, bundle) {
      const direct = new Map<string, readonly string[]>();
      for (const file of Object.values(bundle))
        if (file.type === "chunk") direct.set(file.fileName, [...file.imports]);
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        const seen = new Set<string>();
        const queue = [...file.imports];
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
          if (seen.has(next) || next === file.fileName) continue;
          seen.add(next);
          queue.push(...(direct.get(next) ?? []));
        }
        file.imports = [...seen];
      }
    },
  };
}
