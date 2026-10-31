import { Link } from "@tanstack/react-router";
import type { Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { AudienceMark } from "./audience.tsx";
import { authorName, PersonName } from "./author-name.tsx";
import { Avatar } from "./avatar.tsx";
import { when } from "./outcome.ts";
import { RoleBadge } from "./roles.tsx";

// The top of a post card: who wrote it, when, and, away from its community, which one.

/** What a card names of the community it is shown outside of. */
export type PostCommunity =
  | { communityId: string; name: string; photo: string | null }
  | null
  | undefined;

/** The name a post shows: an anonymous one never carries the author's (decision 0091). */
export function postByline(post: Post): string {
  if (post.anonymous)
    return post.mine ? strings.post_anonymous_mine : strings.post_anonymous_author;
  return authorName(post.author);
}

/** The author's picture, or the neutral one of an anonymous post. */
function PostPicture({
  post,
  className = "size-10 rounded-full",
}: Readonly<{ post: Post; className?: string }>) {
  const shown = post.anonymous ? null : post.author;
  return (
    <Avatar
      kind="person"
      id={post.anonymous ? "anonymous" : (shown?.accountId ?? "")}
      name={shown?.name ?? null}
      photo={shown?.photo ?? null}
      className={className}
    />
  );
}

/** The byline: name, mark and role, or the anonymous wording. */
function PostName({ post }: Readonly<{ post: Post }>) {
  if (post.anonymous) return <span className="font-semibold">{postByline(post)}</span>;
  return (
    <>
      <PersonName author={post.author} />
      <RoleBadge role={post.author?.role ?? null} />
    </>
  );
}

/**
 * Who and where (decision 0116). Seen outside its community a post names the community first, its
 * picture carrying the author's small one, and the author on the line below; inside one, or on a
 * wall, the author is the only line.
 */
export function PostHeading({
  post,
  community,
}: Readonly<{ post: Post; community: PostCommunity }>) {
  const meta = (
    <>
      <time dateTime={new Date(post.createdAt).toISOString()} title={when(post.createdAt)}>
        {relativeTime(post.createdAt)}
      </time>
      <AudienceMark audience={post.audience} />
    </>
  );
  if (community === undefined || community === null) {
    return (
      <>
        <PostPicture post={post} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <PostName post={post} />
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted-fg">{meta}</span>
        </div>
      </>
    );
  }
  return (
    <>
      <span className="relative shrink-0">
        <Avatar
          kind="community"
          id={community.communityId}
          name={community.name}
          photo={community.photo}
          className="size-10 rounded-thumbnail"
        />
        <span className="absolute -bottom-1 -right-1 rounded-full border-2 border-bg">
          <PostPicture post={post} className="size-5 rounded-full text-[0.5rem]" />
        </span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          to="/communities/$communityId"
          params={{ communityId: community.communityId }}
          className="font-semibold [overflow-wrap:anywhere]"
        >
          {community.name}
        </Link>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-fg">
          <span className="flex flex-wrap items-center gap-x-2">
            <PostName post={post} />
          </span>
          {meta}
        </span>
      </div>
    </>
  );
}
