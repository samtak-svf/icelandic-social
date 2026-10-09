import { env, exports } from "cloudflare:workers";
import { CLIENT_HEADER } from "../src/client-version.ts";

// The Worker under test, through its own loopback. `cf workers types` types
// the main module only when cloudflare.config.ts holds the module itself; it
// names a file, so the default export reads as possibly absent. It is there:
// test/worker.ts exports it.
export const bareWorker = exports.default as Fetcher;

/**
 * The Worker as a current client reaches it: every request names a build at
 * the Android floor in Spjall-Client (decision 0030), unless it names one
 * itself. A test that needs a request without the header uses `bareWorker`.
 */
export const worker = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    if (!request.headers.has(CLIENT_HEADER))
      request.headers.set(CLIENT_HEADER, `android/${env.MIN_CLIENT_VERSION_ANDROID}`);
    return bareWorker.fetch(request);
  },
} as Pick<Fetcher, "fetch">;
