import { deleteOrphans } from "./account-deletion.ts";
import { createApp } from "./app.ts";
import { log } from "./log.ts";
import { expireKeyPackages, expireSessions } from "./identity/index.ts";
import { expireCommunities } from "./modules/communities/index.ts";
import { expireMedia } from "./modules/messaging/index.ts";

export { Conversation, Inbox } from "./modules/messaging/objects.ts";

export default {
  fetch: createApp().fetch,
  // The daily cron in cloudflare.config.ts: media past its 30 days (decision 0023)
  // expired KeyPackages (0029), accounts a join left without an identity (0035),
  // and read-only communities past their 90 days (0063).
  async scheduled(_controller, env) {
    log("media.expired", { count: await expireMedia(env) });
    log("key_packages.expired", { count: await expireKeyPackages(env) });
    log("sessions.expired", { count: await expireSessions(env) });
    log("accounts.orphans_deleted", { count: await deleteOrphans(env) });
    log("communities.expired", { count: await expireCommunities(env) });
  },
} satisfies ExportedHandler<Env>;
