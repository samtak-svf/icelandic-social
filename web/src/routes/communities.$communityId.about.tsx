import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { getCommunity } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { About } from "../social/about.tsx";
import { outcome, useLoad } from "../social/outcome.ts";
import { ProblemText, Status } from "../ui/kit.tsx";

// Um samfélagið (decisions 0079, 0080): the whole description, the notice and
// the members, on a screen of its own that the audience line opens.
export const Route = createFileRoute("/communities/$communityId/about")({ component: AboutPage });

function AboutPage() {
  const { communityId } = Route.useParams();
  const [community] = useLoad(
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
      {community?.ok && (
        <>
          <h1 className="font-headline text-3xl [overflow-wrap:anywhere]">{community.data.name}</h1>
          <About community={community.data} />
        </>
      )}
    </>
  );
}
