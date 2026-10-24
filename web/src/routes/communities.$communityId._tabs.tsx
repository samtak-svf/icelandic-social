import { createFileRoute } from "@tanstack/react-router";
import { CommunityFrame } from "../social/community-frame.tsx";

// The layout of a community's tabs (decision 0089): `_tabs` is pathless, so
// Stjórna, Beiðnir and Tilkynningar keep their screens beside it. Each tab is
// a route of its own under this one.
export const Route = createFileRoute("/communities/$communityId/_tabs")({
  component: Tabs,
  staticData: { width: "wide" },
});

function Tabs() {
  return <CommunityFrame communityId={Route.useParams().communityId} />;
}
