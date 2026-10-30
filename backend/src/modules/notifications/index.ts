// Notifications (decisions 0063, 0067): what is addressed to one account, in
// the app and as a push that names nothing. The notifications table is
// written only here.

import type { Handler } from "../jobs/index.ts";
import type { PushSender } from "../messaging/index.ts";
import { noticeHandler } from "./notify.ts";

export { expireNotifications, forgetCommunity } from "./list.ts";
export {
  forgettingFriendNotices,
  withdrawingFriendNotices,
  withdrawingRequestNotice,
} from "./withdraw.ts";
export { notificationRoutes } from "./routes.ts";

/** The handlers of the jobs this module runs, pushing with `sender`. */
export const jobHandlers = (sender: PushSender): Record<string, Handler> => ({
  notice: noticeHandler(sender),
});
