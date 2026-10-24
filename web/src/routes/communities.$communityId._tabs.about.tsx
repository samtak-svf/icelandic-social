import { createFileRoute } from "@tanstack/react-router";
import { About } from "../social/about.tsx";
import { useCommunityTab } from "../social/community-frame.tsx";

// Um (decisions 0079, 0089): the whole description and the facts of the
// community, under its header; the one tab a non-member of a private community has.
export const Route = createFileRoute("/communities/$communityId/_tabs/about")({
  component: AboutTab,
});

function AboutTab() {
  return <About community={useCommunityTab().community} />;
}
