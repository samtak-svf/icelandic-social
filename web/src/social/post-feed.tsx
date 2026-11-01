import type { ReactNode } from "react";
import type { Community, Post } from "../generated/api.ts";
import type { Problem } from "../problem.ts";
import { ProblemText, Status } from "../ui/kit.tsx";
import { CardPlaceholders, Loading } from "../ui/placeholder.tsx";
import type { Outcome } from "./outcome.ts";
import { usePaged, type Page } from "./paged.ts";
import { PostView } from "./post.tsx";
import { mayReplyTo, moderatesAs } from "./roles.tsx";

// The one list of post cards that read from many communities (decisions 0079,
// 0116): the hub's feed and the home feed. A page may be empty and still carry
// `next`, because the server reads a window of time at a time, so an empty
// page is never the end of the list.

export type FeedPhase = "loading" | "problem" | "empty" | "list";

/** What the list shows: it is `empty` only when the last page is in and held nothing. */
export function feedPhase(
  items: readonly unknown[] | null,
  hasMore: boolean,
  problem: Problem | null,
): FeedPhase {
  if (items === null) return problem === null ? "loading" : "problem";
  if (items.length > 0) return "list";
  if (hasMore) return problem === null ? "loading" : "problem";
  return "empty";
}

/** What a feed card names of the community it comes from, or nothing for one not known here. */
function context(community: Community | undefined) {
  return community === undefined
    ? null
    : { communityId: community.communityId, name: community.name, photo: community.photo };
}

export function PostFeed({
  fetchPage,
  byId,
  label,
  empty,
  compose,
}: Readonly<{
  fetchPage: (before: string | undefined) => Promise<Outcome<Page<Post>>>;
  byId: Map<string, Community>;
  label: string;
  empty: ReactNode;
  /** What sits above the cards; it gets the call that loads the list again. */
  compose?: (reload: () => void) => ReactNode;
}>) {
  const feed = usePaged(fetchPage, (post: Post) => post.postId);
  const changed = feed.reload;
  const phase = feedPhase(feed.items, feed.hasMore, feed.problem);
  return (
    <section
      aria-label={label}
      aria-busy={phase === "loading"}
      className="mt-6 flex flex-col gap-4"
    >
      {compose?.(changed)}
      {phase === "loading" && (
        <Loading>
          <CardPlaceholders />
        </Loading>
      )}
      {feed.problem !== null && (
        <Status>
          <ProblemText problem={feed.problem} />
        </Status>
      )}
      {phase === "empty" && <p className="mt-2 text-muted-fg">{empty}</p>}
      {feed.items !== null && feed.items.length > 0 && (
        <ul className="flex flex-col gap-4">
          {feed.items.map((post) => (
            <li key={post.postId}>
              <PostView
                post={post}
                linked
                deleted={changed}
                changed={changed}
                moderates={moderatesAs(byId.get(post.communityId)?.role ?? null)}
                mayReply={mayReplyTo(post, byId.get(post.communityId))}
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
