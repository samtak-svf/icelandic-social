import { Link } from "@tanstack/react-router";
import type { Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Avatar } from "./avatar.tsx";
import { postByline } from "./post.tsx";
import { useMediaSrc } from "./viewer.tsx";

// A community's featured posts (decision 0088): up to three cards, newest pin
// first. Below an expanded window they are a row between the composer and the
// feed; on an expanded one they sit in the aside (decisions 0087, 0088), and
// `LAYOUTS` says which. Nothing is drawn for none.

/** The first image of a post, or its author's picture when it has none. */
function Thumb({ post }: Readonly<{ post: Post }>) {
  const first = post.media[0];
  const src = useMediaSrc(post.postId, first?.mediaId ?? "");
  if (first !== undefined && src !== null) {
    return <img src={src} alt="" className="size-16 shrink-0 rounded-md object-cover" />;
  }
  return (
    <Avatar
      kind="person"
      id={post.anonymous ? "anonymous" : (post.author?.accountId ?? "")}
      name={post.anonymous ? null : (post.author?.name ?? null)}
      photo={first === undefined && !post.anonymous ? (post.author?.photo ?? null) : null}
      className="size-16 shrink-0 rounded-md text-xl"
    />
  );
}

/** One card: picture, the first lines and the author; it opens the post. */
function FeaturedCard({ post }: Readonly<{ post: Post }>) {
  return (
    <Link
      to="/posts/$postId"
      params={{ postId: post.postId }}
      className="flex min-h-11 gap-3 rounded-md border border-border p-3"
    >
      <Thumb post={post} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="line-clamp-3 break-words">{post.body}</span>
        <span className="truncate text-sm text-muted-fg">{postByline(post)}</span>
      </span>
    </Link>
  );
}

/** The row between the composer and the feed; hidden on an expanded window, where the aside has them. */
export function FeaturedStrip({ featured }: Readonly<{ featured: Post[] }>) {
  if (featured.length === 0) return null;
  return (
    <section aria-label={strings.community_featured} className="expanded:hidden">
      <h2 className="mb-2 text-sm font-semibold">{strings.community_featured}</h2>
      <ul className="flex snap-x gap-3 overflow-x-auto pb-1">
        {featured.map((post) => (
          <li key={post.postId} className="w-72 shrink-0 snap-start">
            <FeaturedCard post={post} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The same cards stacked under `Fest` in the aside. */
export function FeaturedList({ featured }: Readonly<{ featured: Post[] }>) {
  if (featured.length === 0) return null;
  return (
    <section aria-label={strings.community_featured} className="flex flex-col gap-2">
      <h3 className="font-semibold">{strings.community_featured}</h3>
      <ul className="flex flex-col gap-2">
        {featured.map((post) => (
          <li key={post.postId}>
            <FeaturedCard post={post} />
          </li>
        ))}
      </ul>
    </section>
  );
}
