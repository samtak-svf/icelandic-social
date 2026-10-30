import { web } from "spjall-web/server";
import worker from "../src/worker.ts";
import { stagingFetch } from "./staging-app.ts";

// The entry of `--mode staging` (decision 0118). The classes are the real ones,
// never dev/worker.ts's, whose stubs local workerd needs unpinned: here each
// object is pinned to the EU by src/env/, as in production (decision 0001).
export { Conversation, Inbox, Space } from "../src/worker.ts";

export default {
  fetch: (request, env, ctx) => stagingFetch(request, env, ctx, web),
  scheduled: worker.scheduled,
} satisfies ExportedHandler<Env>;
