// The Durable Object class, for the Worker's entry to export. It imports
// cloudflare:workers, which Node cannot load, so it stays out of index.ts:
// scripts/openapi.ts builds the app in Node.

export { Space } from "./do/space.ts";
