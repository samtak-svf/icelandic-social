import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useId, useState, type FormEvent } from "react";
import { useAccount } from "../account.tsx";
import type { Problem } from "../problem.ts";
import {
  getFeed,
  listCommunities,
  myCommunities,
  pinCommunity,
  unpinCommunity,
  type Community,
  type Post,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { Avatar } from "../social/avatar.tsx";
import { outcome, useLoad, type Outcome } from "../social/outcome.ts";
import { usePaged } from "../social/paged.ts";
import { PostView } from "../social/post.tsx";
import { moderatesAs } from "../social/roles.tsx";
import { DotsIcon, Menu, MenuItem } from "../ui/menu.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// Communities (decision 0063) in three tabs (decision 0079): the feed of what
// is new in them, the ones the person is in with the way to find others by
// name and, for a verified account, creating one, and the way to find more.

export const Route = createFileRoute("/communities/")({ component: Communities });

const TABS = [
  ["feed", strings.communities_tab_feed],
  ["mine", strings.communities_tab_mine],
  ["discover", strings.communities_tab_discover],
] as const;
type Tab = (typeof TABS)[number][0];

function Communities() {
  const { state } = useAccount();
  // Loaded whatever the tab chosen, so the names of the feed's communities
  // need no second call once the person has been here.
  const [mine, reloadMine] = useLoad(useCallback(() => outcome(myCommunities(), 200), []));
  const [tab, setTab] = useState<Tab>("mine");
  const byId = new Map((mine?.ok ? mine.data.communities : []).map((c) => [c.communityId, c]));
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-headline text-3xl">{strings.tab_communities}</h1>
        <button
          type="button"
          aria-label={strings.communities_find}
          onClick={() => setTab("discover")}
          className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
        </button>
      </div>
      <div role="group" aria-label={strings.tab_communities} className="mt-2 flex flex-wrap gap-2">
        {TABS.map(([value, label]) => (
          <Button
            key={value}
            aria-pressed={tab === value}
            className="aria-pressed:border-primary aria-pressed:bg-muted"
            onClick={() => setTab(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === "feed" && <Feed byId={byId} />}
      {tab === "mine" && (
        <Mine
          mine={mine}
          reloadMine={reloadMine}
          byId={byId}
          verified={state.status === "signed-in" && state.me.verified}
        />
      )}
      {tab === "discover" && <Discover />}
    </>
  );
}

/** The communities the person is in, the way to make one, and what is new in them (0080). */
function Mine({
  mine,
  reloadMine,
  byId,
  verified,
}: Readonly<{
  mine: Outcome<{ communities: Community[] }> | null;
  reloadMine: () => void;
  byId: Map<string, Community>;
  verified: boolean;
}>) {
  return (
    <>
      <section aria-labelledby="mine" className="mt-6">
        <h2 id="mine" className="sr-only">
          {strings.communities_mine}
        </h2>
        {verified && (
          <Link
            to="/communities/new"
            className="flex min-h-14 items-center gap-3 rounded-md border border-border px-4 py-2"
          >
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-lg bg-muted text-2xl"
            >
              +
            </span>
            <span className="flex min-w-0 flex-col justify-center">
              <span className="font-semibold">{strings.community_create}</span>
              <span className="text-sm text-muted-fg">{strings.communities_create_row_hint}</span>
            </span>
          </Link>
        )}
        {mine === null && <Status>{strings.loading}</Status>}
        {mine?.ok === false && (
          <Status>
            <ProblemText problem={mine.problem} />
          </Status>
        )}
        {mine?.ok && mine.data.communities.length === 0 && (
          <p className="mt-2 text-muted-fg">{strings.communities_empty}</p>
        )}
        {mine?.ok && <CommunityList communities={mine.data.communities} changed={reloadMine} />}
      </section>
      {mine?.ok && mine.data.communities.length > 0 && (
        <section aria-labelledby="from-yours" className="mt-8">
          <h2 id="from-yours" className="text-xl font-semibold">
            {strings.communities_from_yours}
          </h2>
          <Feed byId={byId} />
        </section>
      )}
    </>
  );
}

/** Everything in the person's communities, newest first (decision 0079). */
function Feed({ byId }: Readonly<{ byId: Map<string, Community> }>) {
  const fetchPage = useCallback(
    (before: string | undefined) =>
      outcome(getFeed(before === undefined ? undefined : { query: { before } }), 200),
    [],
  );
  const feed = usePaged(fetchPage, (post: Post) => post.postId);
  const changed = feed.reload;
  return (
    <section aria-label={strings.communities_tab_feed} className="mt-6 flex flex-col gap-4">
      {feed.items === null && feed.problem === null && <Status>{strings.loading}</Status>}
      {feed.problem !== null && (
        <Status>
          <ProblemText problem={feed.problem} />
        </Status>
      )}
      {feed.items?.length === 0 && !feed.hasMore && (
        <p className="mt-2 text-muted-fg">{strings.communities_feed_empty}</p>
      )}
      {feed.items !== null && (
        <ul className="flex flex-col gap-4">
          {feed.items.map((post) => (
            <li key={post.postId}>
              <PostView
                post={post}
                linked
                deleted={changed}
                changed={changed}
                moderates={moderatesAs(byId.get(post.communityId)?.role ?? null)}
                community={context(byId.get(post.communityId))}
              />
            </li>
          ))}
        </ul>
      )}
      {feed.hasMore && feed.problem === null && <div ref={feed.sentinel} aria-hidden="true" />}
    </section>
  );
}

/** What a feed card names of the community it comes from, or nothing for one not known here. */
function context(community: Community | undefined) {
  return community === undefined
    ? null
    : { communityId: community.communityId, name: community.name, photo: community.photo };
}

function CommunityList({
  communities,
  changed,
}: Readonly<{ communities: Community[]; changed?: () => void }>) {
  if (communities.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {communities.map((c) => (
        <li key={c.communityId}>
          <CommunityCard community={c} changed={changed} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One community among the person's or on its way to discovery (decisions 0079
 * and 0080): its picture and name, in bold with a count and a dot while it has
 * posts the person has not seen, otherwise when it was last posted in. A
 * member can pin it to the top of their list from the row's `⋯`.
 */
function CommunityCard({
  community,
  changed,
}: Readonly<{ community: Community; changed?: () => void }>) {
  const unread = community.unread > 0;
  const [problem, setProblem] = useState<Problem | null>(null);
  async function togglePin() {
    setProblem(null);
    const path = { communityId: community.communityId };
    const done = await outcome(
      community.pinned ? unpinCommunity({ path }) : pinCommunity({ path }),
      204,
    );
    if (done.ok) changed?.();
    else setProblem(done.problem);
  }
  return (
    <div className="flex min-h-14 items-center gap-1 rounded-md border border-border pr-1">
      <Link
        to="/communities/$communityId"
        params={{ communityId: community.communityId }}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2"
      >
        <Avatar
          kind="community"
          id={community.communityId}
          name={community.name}
          photo={community.photo}
          className="size-10 rounded-lg"
        />
        <span className="flex min-w-0 flex-col justify-center">
          <span className={`truncate ${unread ? "font-bold" : "font-semibold"}`}>
            {community.name}
          </span>
          <span className="text-sm text-muted-fg">
            {unread ? (
              <span className="inline-flex items-center gap-1 font-medium text-fg">
                {strings.community_new_posts({ count: community.unread })}
                <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              </span>
            ) : community.lastPostAt !== null ? (
              strings.community_last_post({ when: relativeTime(community.lastPostAt) })
            ) : community.audience === "open" ? (
              strings.community_open
            ) : (
              strings.community_private
            )}
            {community.memberCount !== null &&
              ` · ${strings.community_members({ count: community.memberCount })}`}
          </span>
        </span>
      </Link>
      {community.role !== null && changed !== undefined && (
        <Menu label={strings.more_options} icon={<DotsIcon />} align="right">
          {(close) => (
            <MenuItem
              onSelect={() => {
                close();
                void togglePin();
              }}
            >
              {community.pinned ? strings.community_unpin : strings.community_pin}
            </MenuItem>
          )}
        </Menu>
      )}
      {problem && (
        <Status>
          <ProblemText problem={problem} />
        </Status>
      )}
    </div>
  );
}

function Find() {
  const search = useId();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Community[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function find(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const result = await outcome(
      listCommunities({ query: q.trim() === "" ? {} : { q: q.trim() } }),
      200,
    );
    if (result.ok) setFound(result.data.communities);
    else setProblem(result.problem);
  }

  return (
    <section aria-labelledby={`${search}-h`} className="mt-8">
      <h2 id={`${search}-h`} className="text-xl font-semibold">
        {strings.communities_find}
      </h2>
      <form role="search" onSubmit={(event) => void find(event)} className="mt-2 flex gap-2">
        <input
          id={search}
          type="search"
          aria-label={strings.communities_find}
          value={q}
          onChange={(event) => setQ(event.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3"
        />
        <Button tone="primary" type="submit">
          {strings.communities_find}
        </Button>
      </form>
      {found?.length === 0 && (
        <p className="mt-2 text-muted-fg">{strings.communities_none_found}</p>
      )}
      {found && <CommunityList communities={found} />}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </section>
  );
}

/** Every community, to browse and filter, newest first (decision 0079). */
function Discover() {
  const [browse] = useLoad(useCallback(() => outcome(listCommunities(), 200), []));
  return (
    <section aria-label={strings.communities_tab_discover} className="mt-6">
      <Find />
      <section className="mt-4">
        {browse === null && <Status>{strings.loading}</Status>}
        {browse?.ok === false && (
          <Status>
            <ProblemText problem={browse.problem} />
          </Status>
        )}
        {browse?.ok && browse.data.communities.length === 0 && (
          <p className="text-muted-fg">{strings.communities_none_found}</p>
        )}
        {browse?.ok && <CommunityList communities={browse.data.communities} />}
      </section>
    </section>
  );
}
