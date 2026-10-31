import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { useAccount } from "../account.tsx";
import type { Problem } from "../problem.ts";
import {
  closePoll,
  deletePost,
  pinPost,
  unpinPost,
  type Author,
  type Comment,
  type Post,
  type SocialMedia,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Dialog } from "../ui/dialog.tsx";
import { DotsIcon, Menu, MenuItem } from "../ui/menu.tsx";
import { AudienceDialog } from "./audience.tsx";
import { useSuspended } from "./suspended.tsx";
import { authorName } from "./author-name.tsx";
import { Avatar } from "./avatar.tsx";
import { ProblemText, Status } from "../ui/kit.tsx";
import { outcome } from "./outcome.ts";
import { ReportForm } from "./report.tsx";
import { ActionRow, useReactions } from "./post-actions.tsx";
import { PollCard } from "./poll.tsx";
import { postByline, PostHeading, type PostCommunity } from "./post-heading.tsx";
import { isPostTombstone, PostTombstone } from "./post-tombstone.tsx";
import { RoleBadge } from "./roles.tsx";
import { CommentImage } from "./comment-image.tsx";
import { useMediaSrc, useViewer, type ViewerItem } from "./viewer.tsx";

// A post as a community's feed and its own page show it: who wrote it and
// when, its text and images, its reactions and its comment count. A
// moderator also sees what a moderator hid or removed, marked as such. Its
// author deletes it; everyone else reports it.

/** Whether the person signed in wrote what `author` wrote. */
export function useMine(author: Author | null): boolean {
  const { state } = useAccount();
  return author !== null && state.status === "signed-in" && state.me.accountId === author.accountId;
}

/** The mark on content only a moderator sees, or nothing. */
export function StateMark({ state }: Readonly<{ state: Post["state"] }>) {
  if (state === "visible") return null;
  if (state === "pending") return <p className="text-sm font-semibold">{strings.post_pending}</p>;
  return (
    <p className="text-sm font-semibold text-danger">
      {state === "hidden" ? strings.content_hidden : strings.content_removed}
    </p>
  );
}

type PostViewProps = Readonly<{
  post: Post;
  linked: boolean;
  deleted: () => void;
  /** Called after the post was pinned or unpinned, so the page loads its posts again. */
  changed: () => void;
  /** Whether the caller is the owner or a moderator of the post's community. */
  moderates: boolean;
  community?: PostCommunity;
}>;

export function PostView(props: PostViewProps) {
  return isPostTombstone(props.post) ? (
    <PostTombstone post={props.post} moderates={props.moderates} />
  ) : (
    <LivePost {...props} />
  );
}

function LivePost({ post, linked, deleted, changed, moderates, community }: PostViewProps) {
  const reactions = useReactions(post);
  return (
    <article
      aria-label={postByline(post)}
      // Full-bleed on a compact window (decision 0116): the card runs to the screen's edges, with
      // the page's 1rem gutter taken back, and is a box again from medium up.
      className="-mx-4 flex flex-col gap-2 rounded-none border-x-0 border-y border-border p-4 medium:mx-0 medium:rounded-md medium:border"
    >
      <StateMark state={post.state} />
      {post.pinned && <PinnedMark />}
      <header className="flex items-start gap-3">
        <PostHeading post={post} community={post.wall === undefined ? community : null} />
        <PostMenu post={post} deleted={deleted} changed={changed} moderates={moderates} />
      </header>
      {post.body !== "" && <Body post={post} linked={linked} />}
      {post.poll !== undefined && <PollCard post={post} />}
      {post.media.length > 0 && <Images postId={post.postId} media={post.media} />}
      <ActionRow post={post} reactions={reactions} linked={linked} />
      {linked && post.latestComment !== null && post.latestComment.state === "visible" && (
        <LatestComment comment={post.latestComment} />
      )}
      {linked && (
        <Link
          to="/posts/$postId"
          params={{ postId: post.postId }}
          className="flex min-h-11 items-center rounded-full bg-muted px-4 text-muted-fg"
        >
          {strings.post_write_comment}
        </Link>
      )}
    </article>
  );
}

function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 7 3 3v2H7v-2l3-3z" />
    </svg>
  );
}

/** The marker on the post pinned to the top of its community. */
function PinnedMark() {
  return (
    <p className="inline-flex items-center gap-1 text-sm font-medium text-muted-fg">
      <PinIcon />
      {strings.post_pinned}
    </p>
  );
}

/** The newest comment under a card: picture, name, badge and two lines of text; it opens the post. */
function LatestComment({ comment }: Readonly<{ comment: Comment }>) {
  const image = comment.media[0];
  return (
    <div className="flex items-start gap-2">
      <Avatar
        kind="person"
        id={comment.author.accountId}
        name={comment.author.name}
        photo={comment.author.photo}
        className="size-8 rounded-full text-xs"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-post-bubble bg-muted px-3 py-2">
        <Link
          to="/posts/$postId"
          params={{ postId: comment.postId }}
          className="flex min-w-0 flex-col"
        >
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="font-bold">{authorName(comment.author)}</span>
            <RoleBadge role={comment.author.role} />
          </span>
          <span className="line-clamp-2 whitespace-pre-wrap">{comment.body}</span>
        </Link>
        {image !== undefined && <CommentImage postId={comment.postId} media={image} />}
      </div>
    </div>
  );
}

/** The text, cut to five lines with Sjá meira when it is longer, and a link to the post in a feed. */
function Body({ post, linked }: Readonly<{ post: Post; linked: boolean }>) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setCut(el.scrollHeight > el.clientHeight + 1);
  }, [post.body, expanded]);
  const text = (
    <p ref={ref} className={`whitespace-pre-wrap ${expanded ? "" : "line-clamp-5"}`}>
      {post.body}
    </p>
  );
  return (
    <>
      {linked ? (
        <Link to="/posts/$postId" params={{ postId: post.postId }}>
          {text}
        </Link>
      ) : (
        text
      )}
      {cut && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="min-h-11 self-start text-sm font-medium underline"
        >
          {strings.post_see_more}
        </button>
      )}
    </>
  );
}

/** The `⋯` menu: Eyða for the author, Tilkynna for others, Festa or Losa for a moderator. */
function PostMenu({
  post,
  deleted,
  changed,
  moderates,
}: Readonly<{ post: Post; deleted: () => void; changed: () => void; moderates: boolean }>) {
  const mine = useMine(post.author);
  const suspended = useSuspended();
  const [audiencing, setAudiencing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function remove() {
    if (!confirm(strings.post_delete_confirm)) return;
    setProblem(null);
    const done = await outcome(deletePost({ path: { postId: post.postId } }), 204);
    if (done.ok) deleted();
    else setProblem(done.problem);
  }

  async function togglePin() {
    setProblem(null);
    const path = { communityId: post.communityId, postId: post.postId };
    const done = await outcome(post.pinned ? unpinPost({ path }) : pinPost({ path }), 204);
    if (done.ok) changed();
    else setProblem(done.problem);
  }

  async function closeThePoll() {
    setProblem(null);
    const done = await outcome(closePoll({ path: { postId: post.postId } }), 200);
    if (done.ok) changed();
    else setProblem(done.problem);
  }

  const closable = post.poll !== undefined && !post.poll.closed && (mine || moderates);

  return (
    <div className="flex flex-col items-end">
      <Menu label={strings.more_options} icon={<DotsIcon />}>
        {(close) => (
          <>
            {closable && (
              <MenuItem
                onSelect={() => {
                  close();
                  void closeThePoll();
                }}
              >
                {strings.poll_close}
              </MenuItem>
            )}
            {mine && post.wall !== undefined && post.audience !== undefined && !suspended && (
              <MenuItem
                onSelect={() => {
                  close();
                  setAudiencing(true);
                }}
              >
                {strings.wall_audience_label}
              </MenuItem>
            )}
            {moderates && (
              <MenuItem
                onSelect={() => {
                  close();
                  void togglePin();
                }}
              >
                {post.pinned ? strings.post_unpin : strings.post_pin}
              </MenuItem>
            )}
            {mine ? (
              <MenuItem
                tone="danger"
                onSelect={() => {
                  close();
                  void remove();
                }}
              >
                {strings.delete}
              </MenuItem>
            ) : (
              <MenuItem
                onSelect={() => {
                  close();
                  setReporting(true);
                }}
              >
                {strings.report}
              </MenuItem>
            )}
          </>
        )}
      </Menu>
      {sent && <Status>{strings.report_sent}</Status>}
      {problem && (
        <Status>
          <ProblemText problem={problem} />
        </Status>
      )}
      {audiencing && post.audience !== undefined && (
        <AudienceDialog
          postId={post.postId}
          current={post.audience}
          onClose={() => setAudiencing(false)}
          changed={changed}
        />
      )}
      {reporting && (
        <Dialog title={strings.report_title} onClose={() => setReporting(false)}>
          <ReportForm
            target={{ kind: "post", id: post.postId }}
            onSent={() => {
              setReporting(false);
              setSent(true);
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

/** A post's images, up to four, two to a row when there are several; pressing one opens the viewer. */
export function Images({ postId, media }: Readonly<{ postId: string; media: SocialMedia[] }>) {
  const { open, viewer } = useViewer();
  const items: ViewerItem[] = media.map((m, i) => ({
    postId,
    media: m,
    alt:
      media.length > 1
        ? strings.post_image_alt_numbered({ n: i + 1, count: media.length })
        : strings.post_image_alt,
  }));
  return (
    <div className={`grid gap-1 ${media.length > 1 ? "grid-cols-2" : ""}`}>
      {items.map((item, i) => (
        <Image key={item.media.mediaId} item={item} onOpen={() => open(items, i)} />
      ))}
      {viewer}
    </div>
  );
}

/** One image, fetched with the client header the API asks of every call. */
function Image({ item, onOpen }: Readonly<{ item: ViewerItem; onOpen: () => void }>) {
  const { media, alt } = item;
  const src = useMediaSrc(item.postId, media.mediaId);
  const box = "w-full rounded-md bg-muted object-cover";
  const ratio = { aspectRatio: `${media.width} / ${media.height}` };
  if (src === null) return <div className={box} style={ratio} />;
  return (
    <button type="button" onClick={onOpen} className="block rounded-md">
      <img
        src={src}
        alt={alt}
        width={media.width}
        height={media.height}
        className={box}
        style={ratio}
      />
    </button>
  );
}
