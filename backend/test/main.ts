import { exports } from "cloudflare:workers";

// The Worker under test, through its own loopback. `cf workers types` types
// the main module only when cloudflare.config.ts holds the module itself; it
// names a file, so the default export reads as possibly absent. It is there:
// test/worker.ts exports it.
export const worker = exports.default as Fetcher;
