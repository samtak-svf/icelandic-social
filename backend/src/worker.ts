import { deleteOrphans } from "./account-deletion.ts";
import { createApp } from "./app.ts";
import { log } from "./log.ts";
import { expireKeyPackages, expireSessions } from "./identity/index.ts";
import { expireCommunities } from "./modules/communities/index.ts";
import { expireJobs, runJobs } from "./modules/jobs/index.ts";
import { expireMedia, pushSender } from "./modules/messaging/index.ts";
import { expireReports } from "./modules/moderation/index.ts";
import { expireNotifications, jobHandlers } from "./modules/notifications/index.ts";
import { deleteUnattached, dropSpace, purgeRemoved } from "./modules/social/index.ts";

export { Conversation, Inbox } from "./modules/messaging/objects.ts";
export { Space } from "./modules/social/objects.ts";

/** The minute cron's schedule, as cloudflare.config.ts gives it. */
const JOBS_SCHEDULE = "* * * * *";

export default {
  fetch: createApp().fetch,
  // The minute cron in cloudflare.config.ts runs the jobs that are due
  // (decision 0067). The daily one: media past its 30 days (decision 0023)
  // expired KeyPackages (0029), accounts a join left without an identity (0035),
  // read-only communities past their 90 days (0063), images no post took
  // within a day (0065), posts removed by a moderator 90 days ago and reports
  // closed a year ago (0066), and finished jobs and notifications past their
  // time (0067).
  async scheduled(controller, env) {
    if (controller.cron === JOBS_SCHEDULE) {
      const ran = await runJobs(env, jobHandlers(pushSender(env)));
      if (ran.done + ran.retried + ran.failed > 0) log("jobs.ran", { count: ran.done });
      return;
    }
    log("media.expired", { count: await expireMedia(env) });
    log("key_packages.expired", { count: await expireKeyPackages(env) });
    log("sessions.expired", { count: await expireSessions(env) });
    log("accounts.orphans_deleted", { count: await deleteOrphans(env) });
    log("communities.expired", { count: await expireCommunities(env, dropSpace) });
    log("social_media.expired", { count: await deleteUnattached(env, {}) });
    log("posts.purged", { count: await purgeRemoved(env) });
    log("reports.expired", { count: await expireReports(env) });
    log("jobs.expired", { count: await expireJobs(env) });
    log("notifications.expired", { count: await expireNotifications(env) });
  },
} satisfies ExportedHandler<Env>;
