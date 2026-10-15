import { deleteOrphans } from "./accounts.ts";
import { createApp } from "./app.ts";
import { log } from "./log.ts";
import { expireKeyPackages } from "./key-packages.ts";
import { expireMedia } from "./media.ts";

export { Conversation } from "./do/conversation.ts";
export { Inbox } from "./do/inbox.ts";

export default {
  fetch: createApp().fetch,
  // The daily cron in cloudflare.config.ts: media past its 30 days (decision 0023)
  // expired KeyPackages (0029), and accounts a join left without an identity (0035).
  async scheduled(_controller, env) {
    log("media.expired", { count: await expireMedia(env) });
    log("key_packages.expired", { count: await expireKeyPackages(env) });
    log("accounts.orphans_deleted", { count: await deleteOrphans(env) });
  },
} satisfies ExportedHandler<Env>;
