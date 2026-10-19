import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import type { Problem } from "../problem.ts";
import {
  deleteCommunity,
  getCommunity,
  joinCommunity,
  leaveCommunity,
  listCommunityPosts,
  restoreCommunity,
  withdrawJoinRequest,
  type Community,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import { PostComposer } from "../social/composer.tsx";
import { outcome, useLoad } from "../social/outcome.ts";
import { PostView } from "../social/post.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// One community (decision 0063): its name and audience, joining, withdrawing
// a join request or leaving, writing a post, and its posts, newest first. Its
// moderators reach the reports and the join requests from here, and its owner
// deletes it. A platform moderator alone sees a deleted one, and restores it
// within its 30 days (decision 0070).
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
  const moderates = c.role === "owner" || c.role === "moderator";
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
      {moderates && (
        <nav className="mt-4 flex flex-wrap gap-x-6">
          <Link
            to="/communities/$communityId/reports"
            params={{ communityId }}
            className="inline-flex min-h-11 items-center underline"
          >
            {strings.moderation_queue}
          </Link>
          <Link
            to="/communities/$communityId/requests"
            params={{ communityId }}
            className="inline-flex min-h-11 items-center underline"
          >
            {c.pendingJoinRequests !== null && c.pendingJoinRequests > 0
              ? strings.join_requests_waiting({ count: c.pendingJoinRequests })
              : strings.join_requests_title}
          </Link>
        </nav>
      )}
      {reads && <Posts community={c} />}
      {c.role === "owner" && <DeleteCommunity community={c} />}
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

/** The owner deletes the community, once they confirm what goes with it (#364). */
function DeleteCommunity({ community }: Readonly<{ community: Community }>) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  async function remove() {
    if (!confirm(strings.community_delete_confirm({ name: community.name }))) return;
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      deleteCommunity({ path: { communityId: community.communityId } }),
      204,
    );
    setBusy(false);
    if (done.ok) await navigate({ to: "/communities" });
    else setProblem(done.problem);
  }
  return (
    <section className="mt-10 flex flex-col items-start gap-2 border-t border-border pt-4">
      <Button tone="danger" disabled={busy} onClick={() => void remove()}>
        {strings.community_delete}
      </Button>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </section>
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
