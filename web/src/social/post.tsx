import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAccount } from "../account.tsx";
import type { Problem } from "../problem.ts";
import {
  deletePost,
  getPostMedia,
  react,
  unreact,
  type Author,
  type Post,
  type SocialMedia,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Button, ProblemText, Status, VerifiedMark } from "../ui/kit.tsx";
import { outcome, when, type Outcome } from "./outcome.ts";
import { ReportButton } from "./report.tsx";

// A post as a community's feed and its own page show it: who wrote it and
// when, its text and images, its reactions and its comment count. A
// moderator also sees what a moderator hid or removed, marked as such. Its
// author deletes it; everyone else reports it.

const REACTIONS = [
  ["like", "👍", strings.reaction_like],
  ["love", "❤️", strings.reaction_love],
  ["laugh", "😂", strings.reaction_laugh],
  ["wow", "😮", strings.reaction_wow],
  ["sad", "😢", strings.reaction_sad],
] as const;
type Kind = (typeof REACTIONS)[number][0];

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
}: Readonly<{ post: Post; linked: boolean; deleted: () => void }>) {
  const mine = useMine(post.author);
  return (
    <article
      aria-label={authorName(post.author)}
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <StateMark state={post.state} />
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <AuthorName author={post.author} />
        <time dateTime={new Date(post.createdAt).toISOString()} className="text-sm text-muted-fg">
          {when(post.createdAt)}
        </time>
      </header>
      {post.body !== "" && <p className="whitespace-pre-wrap">{post.body}</p>}
      {post.media.length > 0 && <Images postId={post.postId} media={post.media} />}
      <Reactions post={post} />
      <footer className="flex flex-wrap items-center justify-between gap-2">
        {linked ? (
          <Link
            to="/posts/$postId"
            params={{ postId: post.postId }}
            className="inline-flex min-h-11 items-center underline"
          >
            {strings.post_comments({ count: post.commentCount })}
          </Link>
        ) : (
          <span>{strings.post_comments({ count: post.commentCount })}</span>
        )}
        {mine ? (
          <DeleteButton
            ask={strings.post_delete_confirm}
            remove={() => outcome(deletePost({ path: { postId: post.postId } }), 204)}
            deleted={deleted}
          />
        ) : (
          <ReportButton target={{ kind: "post", id: post.postId }} />
        )}
      </footer>
    </article>
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

/** The five reactions; the caller's is pressed, and pressing it again takes it back. */
function Reactions({ post }: Readonly<{ post: Post }>) {
  const [mine, setMine] = useState<Kind | null>(post.myReaction);
  const [busy, setBusy] = useState(false);
  const counts = new Map(post.reactions.map((r) => [r.kind, r.count]));
  // The count as the server gave it, moved by what the caller changed since.
  const count = (kind: Kind) =>
    (counts.get(kind) ?? 0) - (post.myReaction === kind ? 1 : 0) + (mine === kind ? 1 : 0);

  async function choose(kind: Kind) {
    setBusy(true);
    const next = mine === kind ? null : kind;
    const done =
      next === null
        ? await outcome(unreact({ path: { postId: post.postId } }), 204)
        : await outcome(react({ path: { postId: post.postId }, body: { kind: next } }), 204);
    if (done.ok) setMine(next);
    setBusy(false);
  }

  return (
    <div role="group" aria-label={strings.reactions_title} className="flex flex-wrap gap-1">
      {REACTIONS.map(([kind, emoji, label]) => (
        <button
          key={kind}
          type="button"
          aria-label={label}
          aria-pressed={mine === kind}
          disabled={busy}
          onClick={() => void choose(kind)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-border px-2 aria-pressed:border-primary aria-pressed:bg-muted"
        >
          <span aria-hidden="true">{emoji}</span>
          {count(kind) > 0 && <span className="text-sm">{count(kind)}</span>}
        </button>
      ))}
    </div>
  );
}
