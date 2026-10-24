// The modules web/integrity.ts makes at build time.

declare module "virtual:spjall-integrity" {
  /** The SRI value of every script, style and wasm file of the client build. */
  const hashes: import("./integrity.ts").Integrity;
  export default hashes;
}

declare module "virtual:spjall-core" {
  /** The wasm core's glue (web/core/, `cargo xtask fetch web`). */
  export const init: typeof import("./generated/core.d.ts").default;
  export const Core: typeof import("./generated/core.d.ts").Core;
  export type Core = import("./generated/core.d.ts").Core;
  /** Where the core's wasm is served, and its SRI value. */
  export const wasm: { readonly url: string; readonly integrity: string };
}
