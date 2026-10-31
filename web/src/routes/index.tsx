import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { getHome, myCommunities } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { PostComposer, type Target } from "../social/composer.tsx";
import { outcome, useLoad } from "../social/outcome.ts";
import { PostFeed } from "../social/post-feed.tsx";
import { mayPostIn } from "../social/roles.tsx";

// Fljótið (decision 0116): what is new in the communities, among the friends
// and on one's own wall, newest first, and the first place the app opens. The
// composer on top writes on the wall unless another place is picked. Ég is
// /me.
export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [mine] = useLoad(useCallback(() => outcome(myCommunities(), 200), []));
  const communities = mine?.ok ? mine.data.communities : [];
  const byId = new Map(communities.map((c) => [c.communityId, c]));
  const targets: Target[] = communities.filter(mayPostIn).map((c) => ({
    communityId: c.communityId,
    name: c.name,
    anonymousAllowed: c.anonymousPosts,
  }));
  const fetchPage = useCallback(
    (before: string | undefined) =>
      outcome(getHome(before === undefined ? undefined : { query: { before } }), 200),
    [],
  );
  return (
    <>
      <h1 className="sr-only">{strings.tab_feed}</h1>
      <PostFeed
        fetchPage={fetchPage}
        byId={byId}
        label={strings.tab_feed}
        empty={strings.feed_empty}
        compose={(reload) => <PostComposer wall targets={targets} posted={reload} />}
      />
    </>
  );
}
