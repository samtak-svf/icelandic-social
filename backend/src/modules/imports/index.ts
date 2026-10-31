// Bringing a person's own posts in from another platform (decisions 0119, 0120).
// Every feed, whichever route it reads, delivers to this one core. The tables
// it owns are written only here.

import type { Handler } from "../jobs/index.ts";
import { connectionJobHandlers } from "./scrape-jobs.ts";
import { jobHandlers as coreJobs } from "./core.ts";
import { fileJobHandlers } from "./file-jobs.ts";

export { connectionRoutes } from "./connection-routes.ts";
export { expireUnproven } from "./connections.ts";
export { scrapeHealth, startDueScrapes } from "./scrape-jobs.ts";
export { importPost, openImport, requestRemoval, type SourcePost } from "./core.ts";
export { deleteAccountFiles, expireFiles } from "./file.ts";
export { importRoutes } from "./routes.ts";

/** The handlers of the jobs this module runs. */
export const jobHandlers = (): Record<string, Handler> => ({
  ...coreJobs(),
  ...fileJobHandlers(),
  ...connectionJobHandlers(),
});
