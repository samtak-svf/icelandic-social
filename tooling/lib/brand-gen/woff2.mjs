// @ts-check
// TTF to WOFF2 with Google's reference encoder (wawoff2, compiled to wasm).
// The web serves its fonts as WOFF2, about a third smaller than the TTF the
// apps bundle even after the CDN's own compression. The encoder is
// deterministic, so `brand-gen --check` can compare the output byte for byte.
//
// The runtime starts once, when this module loads; after that a conversion is
// synchronous, so generation stays a plain function. A conversion takes about
// half a second, so each font is encoded once per process, keyed by its bytes.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
/** @type {{ calledRun?: boolean, onRuntimeInitialized?: () => void, compress(ttf: Uint8Array): Uint8Array | false }} */
const encoder = require("wawoff2/build/compress_binding.js");
if (!encoder.calledRun) {
  await new Promise((resolve) => {
    encoder.onRuntimeInitialized = () => resolve(undefined);
  });
}

/** @type {Map<string, Buffer>} */
const encoded = new Map();

/**
 * @param {Buffer} ttf
 * @returns {Buffer}
 */
export function woff2(ttf) {
  const key = createHash("sha256").update(ttf).digest("hex");
  let out = encoded.get(key);
  if (!out) {
    const result = encoder.compress(ttf);
    if (result === false) throw new Error("not a TrueType font WOFF2 can encode");
    out = Buffer.from(result);
    encoded.set(key, out);
  }
  return out;
}
