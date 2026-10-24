import { createFileRoute } from "@tanstack/react-router";
import { MemberList } from "../social/about.tsx";
import { useCommunityTab } from "../social/community-frame.tsx";

// Meðlimir (decision 0089): the owner and the moderators first, then the
// members by name, as the API orders them. The route is `people` because
// `members` is the management side's (decision 0079).
export const Route = createFileRoute("/communities/$communityId/_tabs/people")({
  component: PeopleTab,
});

function PeopleTab() {
  return <MemberList members={useCommunityTab().members ?? null} />;
}
