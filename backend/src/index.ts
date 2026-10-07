import { createApp } from "./app.ts";
import { log } from "./log.ts";
import { expireMedia } from "./media.ts";

export { Conversation } from "./do/conversation.ts";
export { Inbox } from "./do/inbox.ts";

export default {
  fetch: createApp().fetch,
  // The daily cron in wrangler.jsonc: media past its 30 days (decision 0023).
  async scheduled(_controller, env) {
    log("media.expired", { count: await expireMedia(env) });
  },
} satisfies ExportedHandler<Env>;
