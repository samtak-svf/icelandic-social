import { Link } from "@tanstack/react-router";
import type { Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { when } from "./outcome.ts";

/**
 * Whether `post` is what a reader gets of a post a moderator removed (decision 0115): no
 * byline, no text, no image. A moderator's copy on the post's own page keeps all three.
 */
export function isPostTombstone(post: Post): boolean {
  return (
    post.state === "removed" &&
    post.author === null &&
    !post.anonymous &&
    post.body === "" &&
    post.media.length === 0
  );
}

/** A removed post's place: its author is led to the reasons, a moderator to the post. */
export function PostTombstone({ post, moderates }: Readonly<{ post: Post; moderates: boolean }>) {
  return (
    <article className="flex flex-col gap-1 rounded-md border border-border p-4 text-muted-fg">
      <p className="font-semibold">{strings.content_removed}</p>
      <time dateTime={new Date(post.createdAt).toISOString()} className="text-sm">
        {when(post.createdAt)}
      </time>
      {post.mine && (
        <Link to="/statements" className="text-fg underline">
          {strings.statement_open}
        </Link>
      )}
      {moderates && (
        <Link to="/posts/$postId" params={{ postId: post.postId }} className="text-fg underline">
          {strings.post_tombstone_open}
        </Link>
      )}
    </article>
  );
}
