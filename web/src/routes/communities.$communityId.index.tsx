import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { Problem } from "../problem.ts";
import {
  getCommunity,
  joinCommunity,
  listCommunityPosts,
  restoreCommunity,
  withdrawJoinRequest,
  type Community,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import { CommunityBar, CommunityHeader } from "../social/community-header.tsx";
import { PostComposer } from "../social/composer.tsx";
import { outcome, useLoad, type Outcome } from "../social/outcome.ts";
import { PostView } from "../social/post.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// One community (decision 0063): its name and audience, joining, withdrawing
// a join request, writing a post, and its posts, newest first. Um samfélagið
// and Stjórna are screens of their own, reached from the audience line and
// the `⋯` menu (decision 0080), and leaving is in that menu. A platform moderator
// alone sees a deleted one, and restores it within its 30 days (decision
// 0070).
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
  if (c.deletedAt !== null) return <Deleted community={c} restored={reload} />;
  const reads = c.role !== null || c.audience === "open";
  return (
    <>
      <CommunityBar community={c} changed={reload} />
      <CommunityHeader community={c} readable={reads} />
      <Membership community={c} changed={reload} />
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

  async function change(pending: Promise<Outcome<unknown>>) {
    setBusy(true);
    setProblem(null);
    const done = await pending;
    setBusy(false);
    if (done.ok) changed();
    else if (done.problem) setProblem(done.problem);
  }

  const declinedUntil = community.joinDeclinedUntil;
  let control = null;
  if (declinedUntil !== null && declinedUntil > Date.now()) {
    control = (
      <>
        <p>{strings.community_join_declined}</p>
        <p className="text-sm text-muted-fg">
          {strings.community_join_again({ date: formatIsDate(declinedUntil) })}
        </p>
      </>
    );
  } else if (community.joinRequested) {
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
  }
  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      {control}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </div>
  );
}

const RESTORABLE_MS = 30 * 24 * 60 * 60 * 1000;

/** What a platform moderator sees of a deleted community: when it goes, and the way back. */
function Deleted({
  community,
  restored,
}: Readonly<{ community: Community; restored: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const deletedAt = community.deletedAt ?? 0;
  async function restore() {
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      restoreCommunity({ path: { communityId: community.communityId } }),
      200,
    );
    setBusy(false);
    if (done.ok) restored();
    else setProblem(done.problem);
  }
  return (
    <>
      <h1 className="font-headline text-3xl">{community.name}</h1>
      <p className="mt-2">
        {strings.community_deleted_notice({ date: formatIsDate(deletedAt + RESTORABLE_MS) })}
      </p>
      <div className="mt-4 flex flex-col items-start gap-2">
        <Button tone="primary" disabled={busy} onClick={() => void restore()}>
          {strings.community_restore}
        </Button>
        <Status>{problem && <ProblemText problem={problem} />}</Status>
      </div>
    </>
  );
}

function Posts({ community }: Readonly<{ community: Community }>) {
  const { communityId } = community;
  // A letter typed starts the search 300 ms after it lands, so the list is
  // not called everything someone writes (#0079).
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const [posts, reload] = useLoad(
    useCallback(
      () =>
        outcome(
          listCommunityPosts({
            path: { communityId },
            query: searched === "" ? {} : { q: searched },
          }),
          200,
        ),
      [communityId, searched],
    ),
  );
  const muted = community.mutedUntil !== null && community.mutedUntil > Date.now();
  return (
    <section className="mt-6 flex flex-col gap-4">
      {community.role !== null && !muted && (
        <PostComposer communityId={communityId} posted={reload} />
      )}
      {muted && <p>{strings.community_muted}</p>}
      <label className="sr-only" htmlFor="community-posts-search">
        {strings.community_search_posts}
      </label>
      <input
        id="community-posts-search"
        type="search"
        placeholder={strings.community_search_posts}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
      />
      {posts === null && <Status>{strings.loading}</Status>}
      {posts?.ok === false && (
        <Status>
          <ProblemText problem={posts.problem} />
        </Status>
      )}
      {posts?.ok && posts.data.posts.length === 0 && (
        <p className="text-muted-fg">
          {searched === "" ? strings.posts_empty : strings.community_search_empty}
        </p>
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
