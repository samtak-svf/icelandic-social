import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import type { Problem } from "../account.tsx";
import {
  getCommunity,
  joinCommunity,
  leaveCommunity,
  listCommunityPosts,
  withdrawJoinRequest,
  type Community,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { PostComposer } from "../social/composer.tsx";
import { outcome, useLoad } from "../social/outcome.ts";
import { PostView } from "../social/post.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// One community (decision 0063): its name and audience, joining, withdrawing
// a join request or leaving, writing a post, and its posts, newest first. Its moderators reach the
// reports from here.
export const Route = createFileRoute("/communities/$communityId/")({ component: CommunityPage });

function CommunityPage() {
  const { communityId } = Route.useParams();
  const [community, reload] = useLoad(
    useCallback(() => outcome(getCommunity({ path: { communityId } }), 200), [communityId]),
  );
  if (community === null) return <Status>{strings.loading}</Status>;
  if (!community.ok) {
    return (
      <Status>
        <ProblemText problem={community.problem} />
      </Status>
    );
  }
  const c = community.data;
  const reads = c.role !== null || c.audience === "open";
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-headline text-3xl">{c.name}</h1>
        <p className="text-sm text-muted-fg">
          {c.audience === "open" ? strings.community_open : strings.community_private}
          {c.memberCount !== null && ` · ${strings.community_members({ count: c.memberCount })}`}
        </p>
        {c.description !== "" && <p className="whitespace-pre-wrap">{c.description}</p>}
      </header>
      <Membership community={c} changed={reload} />
      {(c.role === "owner" || c.role === "moderator") && (
        <Link
          to="/communities/$communityId/reports"
          params={{ communityId }}
          className="mt-4 inline-flex min-h-11 items-center underline"
        >
          {strings.moderation_queue}
        </Link>
      )}
      {reads && <Posts community={c} />}
    </>
  );
}

function Membership({
  community,
  changed,
}: Readonly<{ community: Community; changed: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const path = { communityId: community.communityId };

  async function change(pending: Promise<{ ok: boolean; problem?: Problem }>) {
    setBusy(true);
    setProblem(null);
    const done = await pending;
    setBusy(false);
    if (done.ok) changed();
    else if (done.problem) setProblem(done.problem);
  }

  let control = null;
  if (community.joinRequested) {
    control = (
      <>
        <p>{strings.community_join_requested}</p>
        <Button
          disabled={busy}
          onClick={() => void change(outcome(withdrawJoinRequest({ path }), 204))}
        >
          {strings.community_withdraw_request}
        </Button>
      </>
    );
  } else if (community.role === null) {
    const label =
      community.audience === "open" ? strings.community_join : strings.community_request_join;
    control = (
      <Button
        tone="primary"
        disabled={busy}
        onClick={() => void change(outcome(joinCommunity({ path }), 200))}
      >
        {label}
      </Button>
    );
  } else if (community.role !== "owner") {
    control = (
      <Button disabled={busy} onClick={() => void change(outcome(leaveCommunity({ path }), 204))}>
        {strings.community_leave}
      </Button>
    );
  }
  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      {control}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </div>
  );
}

function Posts({ community }: Readonly<{ community: Community }>) {
  const { communityId } = community;
  const [posts, reload] = useLoad(
    useCallback(() => outcome(listCommunityPosts({ path: { communityId } }), 200), [communityId]),
  );
  const muted = community.mutedUntil !== null && community.mutedUntil > Date.now();
  return (
    <section className="mt-6 flex flex-col gap-4">
      {community.role !== null && !muted && (
        <PostComposer communityId={communityId} posted={reload} />
      )}
      {muted && <p>{strings.community_muted}</p>}
      {posts === null && <Status>{strings.loading}</Status>}
      {posts?.ok === false && (
        <Status>
          <ProblemText problem={posts.problem} />
        </Status>
      )}
      {posts?.ok && posts.data.posts.length === 0 && (
        <p className="text-muted-fg">{strings.posts_empty}</p>
      )}
      {posts?.ok && (
        <ul className="flex flex-col gap-4">
          {posts.data.posts.map((post) => (
            <li key={post.postId}>
              <PostView post={post} linked deleted={reload} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
