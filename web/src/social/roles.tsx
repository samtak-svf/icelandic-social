import type { Author, Community, Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Outcome } from "./outcome.ts";

// The badge beside a name (decision 0080): the byline of a post or comment
// carries the author's role in its community, so nothing here asks for more.

/** Whether a caller with the community role `role` is the owner or a moderator. */
export function moderatesAs(role: "owner" | "moderator" | "member" | null): boolean {
  return role === "owner" || role === "moderator";
}

type Standing = Pick<Community, "role" | "mutedUntil" | "readOnly">;

/** Whether a moderator has muted the caller in `community` now. */
function mutedIn(community: Standing): boolean {
  return community.mutedUntil !== null && community.mutedUntil > Date.now();
}

/** Whether the caller may write in `community` now, as the server decides: a member, of any role, in a community that is not read-only, and not muted there. */
export function mayPostIn(community: Standing): boolean {
  return community.role !== null && !community.readOnly && !mutedIn(community);
}

/** What tells a member why there is no composer, or null when there is one or the caller has not joined. */
export function noPostNotice(community: Standing): string | null {
  if (community.role === null) return null;
  if (community.readOnly) return strings.community_read_only;
  return mutedIn(community) ? strings.community_muted : null;
}

/**
 * Whether the caller may reply to `post` (comment, react, vote), as the server's `replyRefusal`
 * decides: only a visible post takes replies, and a wall asks no community. A community not known
 * here leaves the answer to the server, as does a block, which the caller cannot see.
 */
export function mayReplyTo(post: Pick<Post, "state" | "wall">, community?: Standing): boolean {
  if (post.state !== "visible") return false;
  return post.wall !== undefined || community === undefined || mayPostIn(community);
}

export type PostStanding = {
  /** Whether the caller is the owner or a moderator of the post's community. */
  moderates: boolean;
  mayReply: boolean;
  /** What tells a member why there is no comment box, or null. */
  notice: string | null;
};

/**
 * The caller's standing on a post's own page, from its community as loaded: nothing to write in
 * until that has answered, and a community that failed to load leaves the answer to the server.
 */
export function postStanding(
  post: Pick<Post, "state" | "wall">,
  loaded: Outcome<Standing | null> | null,
): PostStanding {
  if (loaded === null) return { moderates: false, mayReply: false, notice: null };
  const community = loaded.ok && loaded.data !== null ? loaded.data : undefined;
  return {
    moderates: community !== undefined && moderatesAs(community.role),
    mayReply: mayReplyTo(post, community),
    notice: community === undefined ? null : noPostNotice(community),
  };
}

/** Eigandi or Stjórnandi beside a name; nothing for a member. */
export function RoleBadge({ role }: Readonly<{ role: Author["role"] }>) {
  if (role === null) return null;
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium leading-none text-fg">
      {role === "owner" ? strings.community_role_owner : strings.community_role_moderator}
    </span>
  );
}
