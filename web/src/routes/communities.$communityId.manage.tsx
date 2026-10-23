import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { getCommunity } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Manage } from "../social/moderate.tsx";
import { outcome, useLoad } from "../social/outcome.ts";
import { ProblemText, Status } from "../ui/kit.tsx";

// Stjórna (decisions 0079, 0080): what a community's owner and moderators
// reach for, off the reading path. Deleting the community is reachable only
// from here.
export const Route = createFileRoute("/communities/$communityId/manage")({ component: ManagePage });

function ManagePage() {
  const { communityId } = Route.useParams();
  const [community, reload] = useLoad(
    useCallback(() => outcome(getCommunity({ path: { communityId } }), 200), [communityId]),
  );
  return (
    <>
      <Link
        to="/communities/$communityId"
        params={{ communityId }}
        className="inline-flex min-h-11 items-center underline"
      >
        {strings.back}
      </Link>
      {community === null && <Status>{strings.loading}</Status>}
      {community?.ok === false && (
        <Status>
          <ProblemText problem={community.problem} />
        </Status>
      )}
      {/* Only the owner and the moderators have anything to manage; the server refuses the rest. */}
      {community?.ok &&
        (community.data.role === "owner" || community.data.role === "moderator") && (
          <Manage community={community.data} changed={reload} />
        )}
    </>
  );
}
