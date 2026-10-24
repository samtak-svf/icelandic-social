import { createFileRoute } from "@tanstack/react-router";
import { ManageFrame } from "../social/manage-frame.tsx";
import { Roles } from "../social/moderate.tsx";

// Stjórna's members (decisions 0063, 0087): the owner names the moderators,
// on a page of its own that the side navigation of an expanded window
// reaches. On a narrower window the same list is a section of Stjórna.
export const Route = createFileRoute("/communities/$communityId/members")({
  component: MembersPage,
  staticData: { width: "wide" },
});

function MembersPage() {
  const { communityId } = Route.useParams();
  return (
    <ManageFrame communityId={communityId}>
      {(community, changed) =>
        community.role === "owner" && (
          <Roles community={community} changed={changed} heading="page" />
        )
      }
    </ManageFrame>
  );
}
