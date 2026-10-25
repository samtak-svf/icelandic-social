import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { react, unreact, type Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Menu, MenuItem } from "../ui/menu.tsx";
import { Status } from "../ui/kit.tsx";
import { outcome } from "./outcome.ts";

// What sits under a post's text (decision 0080): the reaction summary and the
// Líkar, Athugasemd and Deila row.

const REACTIONS = [
  ["like", "👍", strings.reaction_like],
  ["love", "❤️", strings.reaction_love],
  ["laugh", "😂", strings.reaction_laugh],
  ["wow", "😮", strings.reaction_wow],
  ["sad", "😢", strings.reaction_sad],
] as const;
type Kind = (typeof REACTIONS)[number][0];

/**
 * The reactions as a line: the commonest emoji and their count, and the comments. Like the apps,
 * a post with neither has no line, and a count of none is not shown.
 */
export function Summary({
  post,
  reactions,
  linked,
}: Readonly<{ post: Post; reactions: ReactionState; linked: boolean }>) {
  const comments = strings.post_comments({ count: post.commentCount });
  const top = REACTIONS.map(([kind, emoji]) => [emoji, reactions.count(kind)] as const)
    .filter(([, n]) => n > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3);
  if (reactions.total === 0 && post.commentCount === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-muted-fg">
      {reactions.total > 0 ? (
        <span>
          <span aria-hidden="true">{top.map(([emoji]) => emoji).join("")} </span>
          {strings.reaction_count({ count: reactions.total })}
        </span>
      ) : (
        <span />
      )}
      {post.commentCount === 0 ? null : linked ? (
        <Link
          to="/posts/$postId"
          params={{ postId: post.postId }}
          className="inline-flex min-h-11 items-center underline"
        >
          {comments}
        </Link>
      ) : (
        <span>{comments}</span>
      )}
    </div>
  );
}

// Each action leads with a glyph in the same 20 px box (GLYPH, CommentIcon, ShareIcon), so
// the emoji and the two drawn icons line up.
const GLYPH = "inline-flex size-5 shrink-0 items-center justify-center text-base leading-none";

const ACTION =
  "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-1 font-medium hover:bg-muted";

/** Líkar, Athugasemd and Deila: three equal actions under the post. */
export function ActionRow({
  post,
  reactions,
  linked,
}: Readonly<{ post: Post; reactions: ReactionState; linked: boolean }>) {
  const [told, setTold] = useState(false);
  return (
    <div className="grid grid-cols-3 border-y border-border py-1 text-sm">
      <LikeButton reactions={reactions} />
      {linked ? (
        <Link to="/posts/$postId" params={{ postId: post.postId }} className={ACTION}>
          <CommentIcon />
          {strings.post_comment_action}
        </Link>
      ) : (
        <button
          type="button"
          className={ACTION}
          onClick={() =>
            document.querySelector<HTMLTextAreaElement>("[data-comment-composer] textarea")?.focus()
          }
        >
          <CommentIcon />
          {strings.post_comment_action}
        </button>
      )}
      <Menu
        className="flex min-w-0"
        label={strings.share}
        triggerClassName={`${ACTION} w-full`}
        align="right"
        icon={
          <>
            <ShareIcon />
            {strings.share}
          </>
        }
      >
        {(close) => (
          // The web has no conversations (end-to-end encrypted messaging lives in the apps), and 0080 allows "or copies its link".
          <MenuItem
            onSelect={() => {
              close();
              void navigator.clipboard
                .writeText(`${location.origin}/posts/${post.postId}`)
                .then(() => setTold(true))
                .catch(() => undefined);
            }}
          >
            {strings.post_copy_link}
          </MenuItem>
        )}
      </Menu>
      {told && (
        <div className="col-span-3 px-1">
          <Status>{strings.post_link_copied}</Status>
        </div>
      )}
    </div>
  );
}

const HOLD_MS = 450;

/**
 * Líkar: one press likes or takes the reaction back. A long press, or the
 * pointer resting on it, opens the five reactions; so does the arrow-up key,
 * which a keyboard has instead of either.
 */
function LikeButton({ reactions }: Readonly<{ reactions: ReactionState }>) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const mine = reactions.mine;
  const shown = mine === null ? null : REACTIONS.find(([kind]) => kind === mine);

  const later = (fn: () => void, ms: number) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <div
      className="relative flex"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") later(() => setOpen(true), HOLD_MS);
      }}
      onPointerLeave={() => {
        cancel();
        setOpen(false);
      }}
    >
      <button
        type="button"
        aria-pressed={mine !== null}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={reactions.busy}
        className={`${ACTION} w-full aria-pressed:text-primary`}
        onPointerDown={(event) => {
          held.current = false;
          if (event.pointerType !== "mouse") {
            later(() => {
              held.current = true;
              setOpen(true);
            }, HOLD_MS);
          }
        }}
        onPointerUp={cancel}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        onClick={() => {
          // The press that opened the picker is not also a like.
          if (held.current) {
            held.current = false;
            return;
          }
          void reactions.choose(mine ?? "like");
        }}
      >
        <span aria-hidden="true" className={GLYPH}>
          {shown ? shown[1] : "👍"}
        </span>
        {shown ? shown[2] : strings.post_like}
      </button>
      {open && (
        <div
          role="group"
          aria-label={strings.post_reactions_more}
          className="absolute bottom-full left-0 z-20 flex gap-1 rounded-full border border-border bg-surface p-1 shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          {REACTIONS.map(([kind, emoji, label]) => (
            <button
              key={kind}
              type="button"
              aria-label={label}
              aria-pressed={reactions.mine === kind}
              onClick={() => {
                setOpen(false);
                void reactions.choose(kind, true);
              }}
              className="inline-flex size-11 items-center justify-center rounded-full text-2xl hover:bg-muted aria-pressed:bg-muted"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />
    </svg>
  );
}

export type ReactionState = ReturnType<typeof useReactions>;

/** The caller's reaction and the counts as the server gave them, moved by what the caller changed since. */
export function useReactions(post: Post) {
  const [mine, setMine] = useState<Kind | null>(post.myReaction);
  const [busy, setBusy] = useState(false);
  const counts = new Map(post.reactions.map((r) => [r.kind, r.count]));
  const count = (kind: Kind) =>
    (counts.get(kind) ?? 0) - (post.myReaction === kind ? 1 : 0) + (mine === kind ? 1 : 0);
  const total = REACTIONS.reduce((sum, [kind]) => sum + count(kind), 0);

  /** Sets `kind`, or takes it back when it is already the caller's (`pick` sets it even then). */
  async function choose(kind: Kind, pick = false) {
    setBusy(true);
    const next = mine === kind && !pick ? null : kind;
    const done =
      next === null
        ? await outcome(unreact({ path: { postId: post.postId } }), 204)
        : await outcome(react({ path: { postId: post.postId }, body: { kind: next } }), 204);
    if (done.ok) setMine(next);
    setBusy(false);
  }
  return { mine, busy, count, total, choose };
}
