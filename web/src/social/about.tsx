import { useCallback } from "react";
import { listCommunityMembers, type Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Avatar } from "./avatar.tsx";
import { outcome, useLoad } from "./outcome.ts";
import { ProblemText, Status, VerifiedMark } from "../ui/kit.tsx";

// Um samfélagið (decision 0079): the whole description, where it is hosted,
// and the members with their roles.

/** The panel the meta row of a community opens. */
export function About({ community }: Readonly<{ community: Community }>) {
  const [members] = useLoad(
    useCallback(
      () => outcome(listCommunityMembers({ path: { communityId: community.communityId } }), 200),
      [community.communityId],
    ),
  );
  return (
    <section
      aria-label={strings.community_info}
      className="mt-4 flex flex-col gap-3 rounded-md border border-border p-3"
    >
      {community.description !== "" && (
        <p className="whitespace-pre-wrap">{community.description}</p>
      )}
      <p className="text-sm text-muted-fg">{strings.community_not_encrypted_notice}</p>
      <h2 className="text-lg font-semibold">{strings.community_members_title}</h2>
      {members === null && <Status>{strings.loading}</Status>}
      {members?.ok === false && (
        <Status>
          <ProblemText problem={members.problem} />
        </Status>
      )}
      {members?.ok && members.data.members.length > 0 && (
        <ul className="flex flex-col gap-2">
          {members.data.members.map((member) => (
            <li key={member.accountId} className="flex items-center gap-2">
              <Avatar
                kind="person"
                id={member.accountId}
                name={member.name}
                photo={null}
                className="size-8 rounded-md text-sm"
              />
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold">{member.name ?? strings.person_unnamed}</span>
                {member.verified && <VerifiedMark className="text-sm" />}
              </span>
              {member.role !== "member" && (
                <span className="text-sm text-muted-fg">
                  {member.role === "owner"
                    ? strings.community_role_owner
                    : strings.community_role_moderator}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
