import { web } from "spjall-web/server";
import worker from "./worker.ts";

export { Conversation, Inbox } from "./worker.ts";

// The deployed entry: one Worker on one host (decision 0062). The API owns
// its paths and the web app every other one, so the web reaches its data
// only through the API (decision 0005). The tests run src/worker.ts, the API
// alone; `cf dev --mode interop` splits the same way (dev/worker.ts).
export const API_PATHS = /^\/(v1|auth|l|oauth|\.well-known)\/|^\/health$/;

export default {
  fetch(request, env, ctx) {
    if (API_PATHS.test(new URL(request.url).pathname)) return worker.fetch(request, env, ctx);
    return web(request);
  },
  scheduled: worker.scheduled,
} satisfies ExportedHandler<Env>;
