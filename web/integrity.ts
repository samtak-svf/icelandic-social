import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// Subresource Integrity for everything the page loads (decisions 0064, 0081).
//
// Two virtual modules carry hashes made at build time:
//
// - `virtual:spjall-integrity`, read by the server: the SHA-384 of every
//   script, style and wasm file of the client build, by its URL path. The
//   client is built before the server (Start's buildApp), so the server build
//   reads the hashes of the very files it will serve. The page response is
//   stamped from it (src/integrity.ts).
// - `virtual:spjall-core`, read by the chat worker: the wasm core from
//   web/core/ (filled by `cargo xtask fetch web`) with its URL and integrity,
//   so the worker fetches the core with `integrity`. A build without the core
//   fails here, never at run time.
//
// A `new Worker()` script cannot carry SRI; it is served only from this host,
// under `worker-src 'self'`, and listed in the published hashes (deploy.yml).

const INTEGRITY = "virtual:spjall-integrity";
const CORE = "virtual:spjall-core";
const CORE_DIR = fileURLToPath(new URL("./core/", import.meta.url));

/** The SRI value of these bytes: SHA-384, base64. */
export function sri(bytes: string | Uint8Array): string {
  return `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
}

/** Whether a built file is one the page fetches with `integrity`. */
const HASHED = /\.(?:m?js|css|wasm)$/;

export function integrity(): Plugin[] {
  const hashes = new Map<string, string>();
  let base = "/";
  return [
    {
      name: "spjall:integrity",
      configResolved(config) {
        base = config.base;
      },
      resolveId(id) {
        return id === INTEGRITY ? `\0${INTEGRITY}` : undefined;
      },
      load(id) {
        if (id !== `\0${INTEGRITY}`) return undefined;
        if (this.environment.mode === "build" && hashes.size === 0)
          this.error("the client build has not run: no integrity to serve");
        return `export default ${JSON.stringify(Object.fromEntries(hashes))};`;
      },
      // `post`, after Vite's own generateBundle has written the preload lists
      // into the chunks: the hash is of the file as it is written.
      generateBundle: {
        order: "post",
        handler(_options, bundle) {
          if (this.environment.name !== "client") return;
          for (const file of Object.values(bundle)) {
            if (!HASHED.test(file.fileName)) continue;
            hashes.set(
              `${base}${file.fileName}`,
              sri(file.type === "chunk" ? file.code : file.source),
            );
          }
        },
      },
    },
    {
      ...coreModule(),
      // The worker bundle is built by its own plugin list.
      config: () => ({ worker: { format: "es", plugins: () => [coreModule()] } }),
    },
  ];
}

function coreModule(): Plugin {
  return {
    name: "spjall:core-module",
    resolveId(id) {
      return id === CORE ? `\0${CORE}` : undefined;
    },
    load(id) {
      if (id !== `\0${CORE}`) return undefined;
      const glue = `${CORE_DIR}spjall_wasm.js`;
      const binary = `${CORE_DIR}spjall_wasm_bg.wasm`;
      if (!existsSync(glue) || !existsSync(binary))
        this.error(
          "web/core/ holds no core: run `cargo xtask fetch web` (or `cargo xtask core web`)",
        );
      return [
        `export { default as init, Core } from ${JSON.stringify(glue)};`,
        `import url from ${JSON.stringify(`${binary}?url`)};`,
        `export const wasm = { url, integrity: ${JSON.stringify(sri(readFileSync(binary)))} };`,
      ].join("\n");
    },
  };
}
