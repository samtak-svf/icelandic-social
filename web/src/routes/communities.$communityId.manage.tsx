import { createFileRoute } from "@tanstack/react-router";
import { ManageFrame } from "../social/manage-frame.tsx";
import { Manage } from "../social/moderate.tsx";

// Stjórna (decisions 0079, 0080, 0087): what a community's owner and
// moderators reach for, off the reading path. Deleting the community is
// reachable only from here.
export const Route = createFileRoute("/communities/$communityId/manage")({
  component: ManagePage,
  staticData: { width: "wide" },
});

function ManagePage() {
  const { communityId } = Route.useParams();
  return (
    <ManageFrame communityId={communityId}>
      {/* Only the owner and the moderators have anything to manage; the server refuses the rest. */}
      {(community, changed) =>
        (community.role === "owner" || community.role === "moderator") && (
          <Manage community={community} changed={changed} />
        )
      }
    </ManageFrame>
  );
}
