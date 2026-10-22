import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useId, useState, type FormEvent } from "react";
import { useAccount } from "../account.tsx";
import type { Problem } from "../problem.ts";
import {
  createCommunity,
  getFeed,
  listCommunities,
  myCommunities,
  type Community,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Initials } from "../social/avatar.tsx";
import { outcome, useLoad, type Outcome } from "../social/outcome.ts";
import { PostView } from "../social/post.tsx";
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
  const [mine] = useLoad(useCallback(() => outcome(myCommunities(), 200), []));
  const [tab, setTab] = useState<Tab>("mine");
  const byName = new Map(
    (mine?.ok ? mine.data.communities : []).map((c) => [c.communityId, c.name]),
  );
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.tab_communities}</h1>
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
      {tab === "feed" && <Feed byName={byName} />}
      {tab === "mine" && (
        <Mine mine={mine} verified={state.status === "signed-in" && state.me.verified} />
      )}
      {tab === "discover" && <Discover />}
    </>
  );
}

/** The communities the person is in, the find, and, when verified, creating one. */
function Mine({
  mine,
  verified,
}: Readonly<{ mine: Outcome<{ communities: Community[] }> | null; verified: boolean }>) {
  return (
    <>
      <section aria-labelledby="mine" className="mt-6">
        <h2 id="mine" className="text-xl font-semibold">
          {strings.communities_mine}
        </h2>
        {mine === null && <Status>{strings.loading}</Status>}
        {mine?.ok === false && (
          <Status>
            <ProblemText problem={mine.problem} />
          </Status>
        )}
        {mine?.ok && mine.data.communities.length === 0 && (
          <p className="mt-2 text-muted-fg">{strings.communities_empty}</p>
        )}
        {mine?.ok && <CommunityList communities={mine.data.communities} />}
      </section>
      <Find />
      {verified && <Create />}
    </>
  );
}

/** Everything in the person's communities, newest first (decision 0079). */
function Feed({ byName }: Readonly<{ byName: Map<string, string> }>) {
  const [feed, changed] = useLoad(useCallback(() => outcome(getFeed(), 200), []));
  return (
    <section aria-label={strings.communities_tab_feed} className="mt-6 flex flex-col gap-4">
      {feed === null && <Status>{strings.loading}</Status>}
      {feed?.ok === false && (
        <Status>
          <ProblemText problem={feed.problem} />
        </Status>
      )}
      {feed?.ok && feed.data.posts.length === 0 && (
        <p className="mt-2 text-muted-fg">{strings.communities_feed_empty}</p>
      )}
      {feed?.ok && (
        <ul className="flex flex-col gap-4">
          {feed.data.posts.map((post) => (
            <li key={post.postId}>
              <PostView
                post={post}
                linked
                deleted={changed}
                community={
                  byName.has(post.communityId)
                    ? { communityId: post.communityId, name: byName.get(post.communityId) ?? "" }
                    : null
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommunityList({ communities }: Readonly<{ communities: Community[] }>) {
  if (communities.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {communities.map((c) => (
        <li key={c.communityId}>
          <CommunityCard community={c} />
        </li>
      ))}
    </ul>
  );
}

/** One community among the person's or on its way to discovery (decision 0079). */
function CommunityCard({ community }: Readonly<{ community: Community }>) {
  return (
    <Link
      to="/communities/$communityId"
      params={{ communityId: community.communityId }}
      className="flex min-h-14 items-center gap-3 rounded-md border border-border px-4 py-2"
    >
      <Initials name={community.name} className="size-10 rounded-lg" />
      <span className="flex min-w-0 flex-col justify-center">
        <span className="truncate font-semibold">{community.name}</span>
        <span className="text-sm text-muted-fg">
          {community.audience === "open" ? strings.community_open : strings.community_private}
          {community.memberCount !== null &&
            ` · ${strings.community_members({ count: community.memberCount })}`}
        </span>
      </span>
    </Link>
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

function Create() {
  const id = useId();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<"open" | "private">("open");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const made = await outcome(
      createCommunity({ body: { name: name.trim(), description: description.trim(), audience } }),
      200,
    );
    setBusy(false);
    if (made.ok) {
      await navigate({
        to: "/communities/$communityId",
        params: { communityId: made.data.communityId },
      });
    } else setProblem(made.problem);
  }

  const field = "min-h-11 rounded-md border border-border-strong bg-surface px-3";
  return (
    <section aria-labelledby={`${id}-h`} className="mt-8">
      <h2 id={`${id}-h`} className="text-xl font-semibold">
        {strings.community_create}
      </h2>
      <form onSubmit={(event) => void create(event)} className="mt-2 flex flex-col gap-2">
        <label htmlFor={`${id}-name`}>{strings.community_name}</label>
        <input
          id={`${id}-name`}
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={field}
        />
        <label htmlFor={`${id}-description`}>{strings.community_description}</label>
        <textarea
          id={`${id}-description`}
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={`${field} py-2`}
        />
        <fieldset className="flex flex-col">
          {(["open", "private"] as const).map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === value}
                onChange={() => setAudience(value)}
              />
              <span>
                <span className="font-semibold">
                  {value === "open" ? strings.community_open : strings.community_private}
                </span>
                {": "}
                {value === "open" ? strings.community_open_hint : strings.community_private_hint}
              </span>
            </label>
          ))}
        </fieldset>
        <Button tone="primary" type="submit" disabled={busy || name.trim() === ""}>
          {strings.community_create}
        </Button>
        <Status>{problem && <ProblemText problem={problem} />}</Status>
      </form>
    </section>
  );
}
