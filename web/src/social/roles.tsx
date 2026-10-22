import { createContext, useContext, type ReactNode } from "react";
import { useAccount } from "../account.tsx";
import type { CommunityMember } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";

// Who is the community's owner or a moderator, for the badge beside a name
// (decision 0080). The post and comment data carry no role, so the page that
// knows the community's members provides them here; a feed across communities
// provides none and shows no badge.
// TODO(0080): drop this when `Author` carries the author's role in the community.

type Roles = ReadonlyMap<string, CommunityMember["role"]>;
const RolesContext = createContext<Roles>(new Map());

export function RolesProvider({
  members,
  children,
}: Readonly<{ members: readonly CommunityMember[]; children: ReactNode }>) {
  return (
    <RolesContext.Provider value={new Map(members.map((m) => [m.accountId, m.role]))}>
      {children}
    </RolesContext.Provider>
  );
}

/** The role of `accountId` in the community the page is about, or null while unknown. */
function useRole(accountId: string | null): CommunityMember["role"] | null {
  const roles = useContext(RolesContext);
  return accountId === null ? null : (roles.get(accountId) ?? null);
}

/** Whether the person signed in moderates the community the page is about. */
export function useModerates(): boolean {
  const { state } = useAccount();
  const roles = useContext(RolesContext);
  const role = state.status === "signed-in" ? roles.get(state.me.accountId) : undefined;
  return role === "owner" || role === "moderator";
}

/** Stjórnandi or Eigandi beside a name; nothing for a member. */
export function RoleBadge({ accountId }: Readonly<{ accountId: string | null }>) {
  const role = useRole(accountId);
  if (role === null || role === "member") return null;
  return (
    <span className="rounded-full bg-muted px-2 text-xs font-medium text-fg">
      {role === "owner" ? strings.community_role_owner : strings.community_role_moderator}
    </span>
  );
}
