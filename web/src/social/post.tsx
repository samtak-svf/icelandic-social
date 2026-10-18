import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { react, unreact, type Author, type Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { outcome, when } from "./outcome.ts";
import { ReportButton } from "./report.tsx";

// A post as a community's feed and its own page show it: who wrote it and
// when, its text, its reactions and its comment count. A moderator also sees
// what a moderator hid or removed, marked as such.

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

/** The mark on content only a moderator sees, or nothing. */
export function StateMark({ state }: Readonly<{ state: "visible" | "hidden" | "removed" }>) {
  if (state === "visible") return null;
  return (
    <p className="text-sm font-semibold text-danger">
      {state === "hidden" ? strings.content_hidden : strings.content_removed}
    </p>
  );
}

export function PostView({ post, linked }: Readonly<{ post: Post; linked: boolean }>) {
  return (
    <article
      aria-label={authorName(post.author)}
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <StateMark state={post.state} />
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{authorName(post.author)}</span>
        <time dateTime={new Date(post.createdAt).toISOString()} className="text-sm text-muted-fg">
          {when(post.createdAt)}
        </time>
      </header>
      <p className="whitespace-pre-wrap">{post.body}</p>
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
        <ReportButton target={{ kind: "post", id: post.postId }} />
      </footer>
    </article>
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
