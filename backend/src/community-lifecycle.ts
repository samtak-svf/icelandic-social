import type { LifecycleHooks } from "./modules/communities/index.ts";
import { imageRecord, lifecycleRecord } from "./modules/moderation/index.ts";
import { forgetCommunity } from "./modules/notifications/index.ts";
import { dropSpace, featuredFor } from "./modules/social/index.ts";

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
  record: lifecycleRecord,
  recordImage: imageRecord,
  featured: featuredFor,
};
