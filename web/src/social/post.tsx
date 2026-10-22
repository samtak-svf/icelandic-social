import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAccount } from "../account.tsx";
import type { Problem } from "../problem.ts";
import {
  deletePost,
  getPostMedia,
  type Author,
  type Post,
  type SocialMedia,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { relativeTime } from "../lib/relative-time.ts";
import { Dialog } from "../ui/dialog.tsx";
import { DotsIcon, Menu, MenuItem } from "../ui/menu.tsx";
import { Avatar } from "./avatar.tsx";
import { Button, ProblemText, Status, VerifiedMark } from "../ui/kit.tsx";
import { outcome, when, type Outcome } from "./outcome.ts";
import { ReportForm } from "./report.tsx";
import { ActionRow, Summary, useReactions } from "./post-actions.tsx";
import { RoleBadge, useModerates } from "./roles.tsx";

// A post as a community's feed and its own page show it: who wrote it and
// when, its text and images, its reactions and its comment count. A
// moderator also sees what a moderator hid or removed, marked as such. Its
// author deletes it; everyone else reports it.

export function authorName(author: Author | null): string {
  if (author === null) return strings.person_deleted;
  return author.name ?? strings.person_unnamed;
}

/** The author's name, with the verified mark when Kenni vouches for them (#358). */
export function AuthorName({ author }: Readonly<{ author: Author | null }>) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 font-semibold">
      {authorName(author)}
      {author?.verified === true && <VerifiedMark className="text-sm" />}
    </span>
  );
}

/** Whether the person signed in wrote what `author` wrote. */
export function useMine(author: Author | null): boolean {
  const { state } = useAccount();
  return author !== null && state.status === "signed-in" && state.me.accountId === author.accountId;
}

/** Deletes the author's own post or comment, once they confirm. */
export function DeleteButton({
  ask,
  remove,
  deleted,
}: Readonly<{ ask: string; remove: () => Promise<Outcome<unknown>>; deleted: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  async function go() {
    if (!confirm(ask)) return;
    setBusy(true);
    setProblem(null);
    const done = await remove();
    setBusy(false);
    if (done.ok) deleted();
    else setProblem(done.problem);
  }
  return (
    <div className="flex flex-col items-end">
      <Button tone="danger" className="text-sm" disabled={busy} onClick={() => void go()}>
        {strings.delete}
      </Button>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </div>
  );
}

/** The mark on content only a moderator sees, or nothing. */
export function StateMark({ state }: Readonly<{ state: "visible" | "hidden" | "removed" }>) {
  if (state === "visible") return null;
  return (
    <p className="text-sm font-semibold text-danger">
      {state === "hidden" ? strings.content_hidden : strings.content_removed}
    </p>
  );
}

export function PostView({
  post,
  linked,
  deleted,
  community,
}: Readonly<{
  post: Post;
  linked: boolean;
  deleted: () => void;
  community?: { communityId: string; name: string; photo: string | null } | null;
}>) {
  const reactions = useReactions(post);
  return (
    <article
      aria-label={authorName(post.author)}
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <StateMark state={post.state} />
      <header className="flex items-start gap-3">
        <Avatar
          kind="person"
          id={post.author.accountId}
          name={post.author.name}
          className="size-10 rounded-full"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AuthorName author={post.author} />
            <RoleBadge accountId={post.author.accountId} />
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted-fg">
            <time dateTime={new Date(post.createdAt).toISOString()} title={when(post.createdAt)}>
              {relativeTime(post.createdAt)}
            </time>
            {community !== undefined && community !== null && (
              <Link
                to="/communities/$communityId"
                params={{ communityId: community.communityId }}
                className="inline-flex items-center gap-1 font-medium text-fg"
              >
                <Avatar
                  kind="community"
                  id={community.communityId}
                  name={community.name}
                  photo={community.photo}
                  className="size-5 rounded text-[0.6rem]"
                />
                <span className="underline">{community.name}</span>
              </Link>
            )}
          </span>
        </div>
        <PostMenu post={post} deleted={deleted} />
      </header>
      {post.body !== "" && <Body post={post} linked={linked} />}
      {post.media.length > 0 && <Images postId={post.postId} media={post.media} />}
      <Summary post={post} reactions={reactions} linked={linked} />
      <ActionRow post={post} reactions={reactions} linked={linked} />
      {/* TODO(0080): the newest comment as a preview here, once the card data carries it. */}
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

/** The `⋯` menu: Eyða for the author, Tilkynna for others, Festa for a moderator (off until the server pins). */
function PostMenu({ post, deleted }: Readonly<{ post: Post; deleted: () => void }>) {
  const mine = useMine(post.author);
  const moderates = useModerates();
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

  return (
    <div className="flex flex-col items-end">
      <Menu label={strings.more_options} icon={<DotsIcon />}>
        {(close) => (
          <>
            {moderates && (
              // TODO(0080): enabled once the server pins posts.
              <MenuItem disabled onSelect={close}>
                {strings.post_pin}
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

/** A post's images, up to four, two to a row when there are several. */
function Images({ postId, media }: Readonly<{ postId: string; media: SocialMedia[] }>) {
  return (
    <div className={`grid gap-1 ${media.length > 1 ? "grid-cols-2" : ""}`}>
      {media.map((m, i) => (
        <Image
          key={m.mediaId}
          postId={postId}
          media={m}
          alt={
            media.length > 1
              ? strings.post_image_alt_numbered({ n: i + 1, count: media.length })
              : strings.post_image_alt
          }
        />
      ))}
    </div>
  );
}

/** One image, fetched with the client header the API asks of every call. */
function Image({
  postId,
  media,
  alt,
}: Readonly<{ postId: string; media: SocialMedia; alt: string }>) {
  const [src, setSrc] = useState<string | null>(null);
  const { mediaId } = media;
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    void getPostMedia({ path: { postId, mediaId } })
      .then((answer) => {
        if (!live || answer.status !== 200) return;
        url = URL.createObjectURL(answer.data);
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (url !== null) URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [postId, mediaId]);
  const box = "w-full rounded-md bg-muted object-cover";
  const ratio = { aspectRatio: `${media.width} / ${media.height}` };
  if (src === null) return <div className={box} style={ratio} />;
  return (
    <img
      src={src}
      alt={alt}
      width={media.width}
      height={media.height}
      className={box}
      style={ratio}
    />
  );
}
