import { createFileRoute } from "@tanstack/react-router";
import { ManageFrame } from "../social/manage-frame.tsx";
import { Log } from "../social/moderate.tsx";

// Stjórna's log (decisions 0063, 0087): the actions kept, on a page of its
// own that the side navigation of an expanded window reaches. On a narrower
// window the same log is a section of Stjórna.
export const Route = createFileRoute("/communities/$communityId/log")({
  component: LogPage,
  staticData: { width: "wide" },
});

function LogPage() {
  const { communityId } = Route.useParams();
  return (
    <ManageFrame communityId={communityId}>
      {() => <Log communityId={communityId} heading="page" />}
    </ManageFrame>
  );
}
