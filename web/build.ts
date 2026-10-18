import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginOption } from "vite";

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
  ];
}
