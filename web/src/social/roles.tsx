import type { Author, Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";

// The badge beside a name (decision 0080): the byline of a post or comment
// carries the author's role in its community, so nothing here asks for more.

/** Whether a caller with the community role `role` is the owner or a moderator. */
export function moderatesAs(role: "owner" | "moderator" | "member" | null): boolean {
  return role === "owner" || role === "moderator";
}

/** Whether the caller may write in `community` now: a member whose notifications are not muted away (the composer's own test, as on the community's page). */
export function mayPostIn(community: Pick<Community, "role" | "mutedUntil">): boolean {
  const muted = community.mutedUntil !== null && community.mutedUntil > Date.now();
  return community.role !== null && !muted;
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
