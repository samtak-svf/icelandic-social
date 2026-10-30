import { db } from "../env/index.ts";
import { accountExists, blocking } from "../identity/index.ts";
import {
  clearingRequests,
  endingFriendship,
  expireRequests,
  expireSnoozes,
  forgettingFriends,
} from "../modules/friends/index.ts";
import {
  forgettingFriendNotices,
  withdrawingFriendNotices,
  withdrawingRequestNotice,
} from "../modules/notifications/index.ts";

// What friends and notifications do together. Notifications reads friends, so a
// statement crossing the other way is composed here, and each part's rows are
// still written by their own module (decision 0114).

/**
 * Blocks `target` for `blocker`: the block, the end of any friendship and every
 * request both ways, cooldown included, and what they were told of each other,
 * in one batch. Unblocking restores none of it. False when there is no such account.
 */
export async function blockAccount(env: Env, blocker: string, target: string): Promise<boolean> {
  if (!(await accountExists(env, target))) return false;
  await db(env).batch([
    blocking(env, blocker, target),
    ...endingFriendship(env, blocker, target),
    clearingRequests(env, blocker, target),
    withdrawingFriendNotices(env, blocker, target),
  ]);
  return true;
}

/** Every row of `accountId` in friends, both ways, and what others were told by it. */
export async function forgetFriends(env: Env, accountId: string): Promise<void> {
  await db(env).batch([
    ...forgettingFriends(env, accountId),
    forgettingFriendNotices(env, accountId),
  ]);
}

/** The daily sweep: requests past their time, with their notices, and snoozes past theirs. */
export const expireFriendRequests = (env: Env, now = Date.now()): Promise<number> =>
  expireRequests(env, withdrawingRequestNotice, now);

export { expireSnoozes };
