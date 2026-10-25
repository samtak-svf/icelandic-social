import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { listCommunityPosts, type Community, type Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { useCommunityTab } from "../social/community-frame.tsx";
import { FeaturedStrip, feedItemClass } from "../social/featured.tsx";
import { moderatesAs } from "../social/roles.tsx";
import { PostComposer } from "../social/composer.tsx";
import { outcome, useLoad, type Outcome } from "../social/outcome.ts";
import { PostView } from "../social/post.tsx";
import { ProblemText, Status } from "../ui/kit.tsx";

// Umræða (decisions 0063, 0089): writing a post, and the community's posts,
// newest first; the default tab. The search sits behind the icon at the end
// of the tab row (`?search`). The header, joining and the tabs are the
// layout's (social/community-frame.tsx).
export const Route = createFileRoute("/communities/$communityId/_tabs/")({
  component: Discussion,
  validateSearch: (search: Record<string, unknown>): { search?: true } =>
    search.search === true || search.search === "true" ? { search: true } : {},
});

function Discussion() {
  const { community, members, changed } = useCommunityTab();
  return members === undefined ? null : <Posts community={community} refresh={changed} />;
}

function Posts({ community, refresh }: Readonly<{ community: Community; refresh: () => void }>) {
  const { communityId } = community;
  const open = Route.useSearch({ select: (s) => s.search === true });
  // A letter typed starts the search 300 ms after it lands, so the list is
  // not called everything someone writes (#0079).
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
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
        <PostComposer
          communityId={communityId}
          posted={reload}
          anonymousAllowed={community.anonymousPosts}
        />
      )}
      {muted && <p>{strings.community_muted}</p>}
      {searched === "" && <FeaturedStrip featured={community.featured} />}
      {open && <SearchBox query={query} onQuery={setQuery} />}
      <Results
        posts={posts}
        searched={searched}
        community={community}
        reload={reload}
        refresh={refresh}
      />
    </section>
  );
}

function SearchBox({
  query,
  onQuery,
}: Readonly<{ query: string; onQuery: (query: string) => void }>) {
  return (
    <>
      <label className="sr-only" htmlFor="community-posts-search">
        {strings.community_search_posts}
      </label>
      <input
        id="community-posts-search"
        type="search"
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the person just pressed the search icon
        autoFocus
        placeholder={strings.community_search_posts}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
      />
    </>
  );
}

function Results({
  posts,
  searched,
  community,
  reload,
  refresh,
}: Readonly<{
  posts: Outcome<{ posts: Post[] }> | null;
  searched: string;
  community: Community;
  reload: () => void;
  refresh: () => void;
}>) {
  // On an expanded window the featured posts are in the aside, so the feed
  // leaves them out; a search shows every match (decision 0092).
  const aside = searched === "" ? community.featured : [];
  return (
    <>
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
            <li key={post.postId} className={feedItemClass(post.postId, aside)}>
              <PostView
                post={post}
                linked
                deleted={reload}
                changed={() => {
                  reload();
                  refresh();
                }}
                moderates={moderatesAs(community.role)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
