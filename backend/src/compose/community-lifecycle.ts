import type { LifecycleHooks } from "../modules/communities/index.ts";
import { anonymousRecord, imageRecord, lifecycleRecord } from "../modules/moderation/index.ts";
import {
  forgetCommunity,
  withdrawingCommunityInviteNotices,
  withdrawingInviteNotice,
} from "../modules/notifications/index.ts";
import { dropSpace, featuredFor } from "../modules/social/index.ts";

// A community's deletion (decision 0070) reaches the modules that keep
// something of it, so the communities module is handed what each does: the
// purge removes the space and the notifications, and the moderation log
// records the deletion and the restoring in the same batch. The community
// page carries its featured posts (decision 0088), which the space keeps.

export const communityLifecycle: LifecycleHooks = {
  purgeContent: async (env, communityId) => {
    await dropSpace(env, communityId);
    await forgetCommunity(env, communityId);
  },
  // Deleting a community ends every invitation to it, so their notices go (decision 0130).
  record: async (env, communityId, by, event) => [
    ...(await lifecycleRecord(env, communityId, by, event)),
    ...(event === "delete" ? [withdrawingCommunityInviteNotices(env, communityId)] : []),
  ],
  withdrawInvite: withdrawingInviteNotice,
  recordImage: imageRecord,
  recordAnonymous: anonymousRecord,
  featured: featuredFor,
};
