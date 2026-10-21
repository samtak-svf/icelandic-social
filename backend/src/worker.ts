import { deleteOrphans } from "./account-deletion.ts";
import { createApp } from "./app.ts";
import { communityLifecycle } from "./community-lifecycle.ts";
import { jobHandlers } from "./job-handlers.ts";
import { log } from "./log.ts";
import { expireKeyPackages, expireLinkedDevices, expireSessions } from "./identity/index.ts";
import { expireCommunities } from "./modules/communities/index.ts";
import { expireHistory } from "./modules/history/index.ts";
import { expireJobs, jobHealth, runJobs } from "./modules/jobs/index.ts";
import { expireMedia } from "./modules/messaging/index.ts";
import { expireReports } from "./modules/moderation/index.ts";
import { expireNotifications } from "./modules/notifications/index.ts";
import { deleteUnattached, purgeRemoved } from "./modules/social/index.ts";

export { Conversation, Inbox } from "./modules/messaging/objects.ts";
export { Space } from "./modules/social/objects.ts";

/** The minute cron's schedule, as cloudflare.config.ts gives it. */
const JOBS_SCHEDULE = "* * * * *";

export default {
  fetch: createApp().fetch,
  // The minute cron in cloudflare.config.ts runs the jobs that are due
  // (decision 0067) and deletes history transfers past their 24 hours, which
  // a daily sweep would keep up to a day longer (0064). The daily one: media past its 30 days (decision 0023)
  // expired KeyPackages (0029), accounts a join left without an identity (0035),
  // deleted communities past their 30 days and read-only ones past their 90,
  // and the rows of those deleted a year ago (0063, 0070), images no post took
  // within a day (0065), posts removed by a moderator 90 days ago and reports
  // closed a year ago (0066), and finished jobs and notifications past their
  // time (0067). It also counts, by kind, the jobs that failed for good that
  // day and the ones the minute cron has stopped taking (0068).
  async scheduled(controller, env) {
    if (controller.cron === JOBS_SCHEDULE) {
      const ran = await runJobs(env, jobHandlers(env));
      if (ran.done + ran.retried + ran.failed > 0) log("jobs.ran", { count: ran.done });
      const expired = await expireHistory(env);
      if (expired > 0) log("history.expired", { count: expired });
      return;
    }
    log("media.expired", { count: await expireMedia(env) });
    log("key_packages.expired", { count: await expireKeyPackages(env) });
    log("sessions.expired", { count: await expireSessions(env) });
    log("linked_devices.expired", { count: await expireLinkedDevices(env) });
    log("accounts.orphans_deleted", { count: await deleteOrphans(env) });
    log("communities.expired", { count: await expireCommunities(env, communityLifecycle) });
    log("social_media.expired", { count: await deleteUnattached(env, {}) });
    log("posts.purged", { count: await purgeRemoved(env) });
    log("reports.expired", { count: await expireReports(env) });
    log("jobs.expired", { count: await expireJobs(env) });
    log("notifications.expired", { count: await expireNotifications(env) });
    const health = await jobHealth(env);
    for (const [kind, count] of Object.entries(health.failed)) {
      log("jobs.failed", { code: kind, count });
    }
    for (const [kind, count] of Object.entries(health.stuck)) {
      log("jobs.stuck", { code: kind, count });
    }
  },
} satisfies ExportedHandler<Env>;
