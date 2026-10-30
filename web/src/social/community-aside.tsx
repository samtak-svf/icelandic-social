import { Link } from "@tanstack/react-router";
import type { Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { LAYOUTS } from "../ui/layout.ts";
import { AboutFacts } from "./about.tsx";
import { Avatar } from "./avatar.tsx";
import { FeaturedList } from "./featured.tsx";
import type { Members } from "./members.ts";

// `community_info` beside the feed on an expanded window (decision 0087): the
// facts, and the first members' pictures with the way to all of them. It
// stays in view while the feed scrolls; a narrower window shows none of it,
// the header and Um carry the same there.

/** The aside; `members` is left out when the reader may not see them. */
export function CommunityAside({
  community,
  members,
}: Readonly<{ community: Community; members?: Members }>) {
  return (
    <aside
      aria-label={strings.community_info}
      className="hidden flex-col gap-4 rounded-md border border-border p-4 expanded:sticky expanded:top-6 expanded:flex expanded:max-h-[calc(100dvh-3rem)] expanded:overflow-y-auto"
    >
      <h2 className="text-lg font-semibold">{strings.community_info}</h2>
      <FeaturedList featured={community.featured} />
      <AboutFacts community={community} />
      {members?.ok && (
        <>
          <h3 className="font-semibold">
            <Link
              to="/communities/$communityId/people"
              params={{ communityId: community.communityId }}
              className="underline"
            >
              {strings.community_members_title}
            </Link>
          </h3>
          <ul aria-label={strings.community_members_stack} className="flex flex-wrap gap-2">
            {members.data.members.slice(0, LAYOUTS.expanded.memberPictures).map((member) => (
              <li key={member.accountId}>
                <Avatar
                  kind="person"
                  id={member.accountId}
                  name={member.name}
                  photo={member.photo}
                  className="size-10 rounded-full text-sm"
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
