import type { Handler } from "./modules/jobs/index.ts";
import { pushSender } from "./modules/messaging/index.ts";
import { jobHandlers as assistantJobs } from "./modules/assistant/index.ts";
import { jobHandlers as notificationJobs } from "./modules/notifications/index.ts";

// Every job kind and the module that runs it (decision 0067): the minute cron
// and /ops/jobs/drain take the same handlers.

export const jobHandlers = (env: Env): Record<string, Handler> => ({
  ...notificationJobs(pushSender(env)),
  ...assistantJobs(),
});
