import type { Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Avatar } from "./avatar.tsx";
import type { Members } from "./members.ts";
import { ProblemText, Status, VerifiedMark } from "../ui/kit.tsx";

// Um samfélagið (decisions 0079, 0087): the whole description, who may read
// and join, where it is hosted, and the members with their roles. The facts
// are also the community page's aside on an expanded window. The members have
// their own tab (decision 0089).

/** The description, the audience explained, and where the content is kept. */
export function AboutFacts({ community }: Readonly<{ community: Community }>) {
  const closed = community.audience === "private";
  return (
    <>
      {community.description !== "" && (
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{community.description}</p>
      )}
      <p className="text-sm">
        <span className="block font-semibold">
          {closed ? strings.community_private_full : strings.community_open_full}
        </span>
        {closed ? strings.community_private_hint : strings.community_open_hint}
      </p>
      <p className="text-sm text-muted-fg">{strings.community_not_encrypted_notice}</p>
      <p className="text-sm text-muted-fg">{strings.residency_claim}</p>
    </>
  );
}

/** The panel of the Um tab: the facts about the community. */
export function About({ community }: Readonly<{ community: Community }>) {
  return (
    <section
      aria-label={strings.community_info}
      className="mt-4 flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <AboutFacts community={community} />
    </section>
  );
}

/** The member list of the Meðlimir tab: owner and moderators first, as the API orders them. */
export function MemberList({ members }: Readonly<{ members: Members }>) {
  return (
    <section aria-label={strings.community_members_title} className="mt-4 flex flex-col gap-3">
      {members === undefined || members === null ? (
        <Status>{strings.loading}</Status>
      ) : !members.ok ? (
        <Status>
          <ProblemText problem={members.problem} />
        </Status>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.data.members.map((member) => (
            <li key={member.accountId} className="flex items-center gap-2">
              <Avatar
                kind="person"
                id={member.accountId}
                name={member.name}
                photo={member.photo}
                className="size-10 rounded-full text-sm"
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
