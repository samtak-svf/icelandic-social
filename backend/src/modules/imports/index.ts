// Bringing a person's own posts in from another platform (decisions 0119, 0120).
// Every feed, whichever route it reads, delivers to this one core. The tables
// it owns are written only here.

export { importPost, jobHandlers, openImport, requestRemoval, type SourcePost } from "./core.ts";
