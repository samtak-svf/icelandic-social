import { standing } from "../communities/index.ts";
import { entry } from "./log.ts";
import { closingAll } from "./reports.ts";

// What a community's deletion writes here (decision 0070): an entry for its
// deletion and its restoring, so the log kept a year after says who did
// them, and the closing of the reports still open on it.

/** The statements moderation writes with a community's deletion, restoring or purge. */
export async function lifecycleRecord(
  env: Env,
  communityId: string,
  by: string | null,
  event: "delete" | "restore" | "purge",
): Promise<D1PreparedStatement[]> {
  const closed = event === "restore" ? [] : closingAll(env, communityId, by);
  if (by === null || event === "purge") return closed;
  const found = await standing(env, by, communityId, { deleted: true });
  return [
    entry(env, {
      communityId,
      actorId: by,
      asPlatform: found?.role !== "owner",
      action: event === "delete" ? "delete_community" : "restore_community",
      targetKind: "community",
      targetId: communityId,
      targetAccount: null,
      reason: "",
    }),
    ...closed,
  ];
}

const IMAGE_ACTIONS = {
  photo: { set: "set_community_picture", remove: "remove_community_picture" },
  cover: { set: "set_community_cover", remove: "remove_community_cover" },
} as const;

/** The entry for the owner switching anonymous posts on or off (decision 0091). */
export function anonymousRecord(
  env: Env,
  communityId: string,
  by: string,
  on: boolean,
): D1PreparedStatement {
  return entry(env, {
    communityId,
    actorId: by,
    asPlatform: false,
    action: on ? "anonymous_posts_on" : "anonymous_posts_off",
    targetKind: "community",
    targetId: communityId,
    targetAccount: null,
    reason: "",
  });
}

/**
 * The entry for a change of a community's picture or cover (decision 0080),
 * made by its owner or a moderator, written in the same batch as the change.
 */
export function imageRecord(
  env: Env,
  communityId: string,
  by: string,
  kind: "photo" | "cover",
  change: "set" | "remove",
): D1PreparedStatement {
  return entry(env, {
    communityId,
    actorId: by,
    asPlatform: false,
    action: IMAGE_ACTIONS[kind][change],
    targetKind: "community",
    targetId: communityId,
    targetAccount: null,
    reason: "",
  });
}
