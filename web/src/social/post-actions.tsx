import { Link } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { react, unreact, type Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Menu, MenuItem } from "../ui/menu.tsx";
import { Status } from "../ui/kit.tsx";
import { EmojiPicker, QUICK } from "./emoji-picker.tsx";
import { tally } from "./reaction-tally.ts";
import { outcome } from "./outcome.ts";
import { postAddress } from "./own-address.ts";
import { useSuspended } from "./suspended.tsx";

// What sits under a post's text (decision 0080): the Líkar, Athugasemd and Deila row.
// The counts sit inside the pills (decision 0116); a screen reader gets them as the
// pill's description, so the pill's name stays what the action is called.

const LIKE = "👍";

// Each action leads with a glyph in the same 20 px box (GLYPH, ICON), so the emoji and the two
// drawn icons line up. On compact a third of the screen has no room for an icon beside
// Athugasemd, so there, as in the apps, only Líkar has one.
const GLYPH = "inline-flex size-5 shrink-0 items-center justify-center text-base leading-none";
const ICON = "hidden size-5 shrink-0 medium:block";

const ACTION =
  "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-1 font-medium hover:bg-muted disabled:opacity-60";

/** The number in a pill, drawn and hidden from a screen reader, which hears the phrase instead; none for zero. */
function Count({ count }: Readonly<{ count: number }>) {
  return count > 0 ? <span aria-hidden="true">{count}</span> : null;
}

/** Líkar, Athugasemd and Deila: three equal actions under the post. */
export function ActionRow({
  post,
  reactions,
  linked,
  mayReply,
}: Readonly<{ post: Post; reactions: ReactionState; linked: boolean; mayReply: boolean }>) {
  const [told, setTold] = useState(false);
  const commentsId = useId();
  return (
    <div className="grid grid-cols-3 border-y border-border py-1 text-sm">
      <LikeButton reactions={reactions} mayReply={mayReply} />
      {linked ? (
        <Link
          to="/posts/$postId"
          params={{ postId: post.postId }}
          className={ACTION}
          aria-describedby={post.commentCount > 0 ? commentsId : undefined}
        >
          <CommentIcon />
          {strings.post_comment_action}
          <Count count={post.commentCount} />
        </Link>
      ) : (
        <button
          type="button"
          className={ACTION}
          disabled={!mayReply}
          aria-describedby={post.commentCount > 0 ? commentsId : undefined}
          onClick={() =>
            document.querySelector<HTMLTextAreaElement>("[data-comment-composer] textarea")?.focus()
          }
        >
          <CommentIcon />
          {strings.post_comment_action}
          <Count count={post.commentCount} />
        </button>
      )}
      {post.commentCount > 0 && (
        <span id={commentsId} className="sr-only">
          {strings.post_comments({ count: post.commentCount })}
        </span>
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
                .writeText(postAddress(post.postId))
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
 * pointer resting on it, opens the quick bar; so does the arrow-up key,
 * which a keyboard has instead of either. Whoever may not react, suspended or
 * by the post's rule, may still take back the reaction they gave.
 */
function LikeButton({
  reactions,
  mayReply,
}: Readonly<{ reactions: ReactionState; mayReply: boolean }>) {
  const barred = useSuspended() || !mayReply;
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const mine = reactions.mine;
  const shown = mine === null ? null : QUICK.find((q) => q.emoji === mine);
  const [all, setAll] = useState(false);
  const totalId = useId();

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
        setAll(false);
      }}
    >
      <button
        type="button"
        aria-pressed={mine !== null}
        aria-haspopup="true"
        aria-expanded={open && !barred}
        aria-describedby={reactions.total > 0 ? totalId : undefined}
        disabled={reactions.busy || (barred && mine === null)}
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
          void reactions.choose(mine ?? LIKE);
        }}
      >
        <span aria-hidden="true" className={GLYPH}>
          {mine ?? LIKE}
        </span>
        {shown ? shown.label : strings.post_like}
        <Count count={reactions.total} />
      </button>
      {reactions.total > 0 && (
        <span id={totalId} className="sr-only">
          {strings.reaction_count({ count: reactions.total })}
        </span>
      )}
      {open && !barred && (
        <div
          role="group"
          aria-label={strings.post_reactions_more}
          className="absolute bottom-full left-0 z-20 flex flex-col gap-1 rounded-post-bubble border border-border bg-surface p-1 shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <div className="flex gap-1">
            {QUICK.map(({ emoji, label }) => (
              <button
                key={emoji}
                type="button"
                aria-label={label}
                aria-pressed={reactions.mine === emoji}
                onClick={() => {
                  setOpen(false);
                  void reactions.choose(emoji, true);
                }}
                className="inline-flex size-11 items-center justify-center rounded-full text-2xl hover:bg-muted aria-pressed:bg-muted"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              aria-label={strings.post_reactions_all}
              aria-expanded={all}
              onClick={() => setAll((v) => !v)}
              className="inline-flex size-11 items-center justify-center rounded-full text-2xl hover:bg-muted"
            >
              +
            </button>
          </div>
          {all && (
            <EmojiPicker
              chosen={reactions.mine}
              onPick={(emoji) => {
                setOpen(false);
                setAll(false);
                void reactions.choose(emoji, true);
              }}
            />
          )}
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
      className={ICON}
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
      className={ICON}
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
  const first = post.myEmoji === "" ? null : post.myEmoji;
  const [mine, setMine] = useState<string | null>(first);
  const [busy, setBusy] = useState(false);
  const { emojis, total, count } = tally(post.emojis, first, mine);

  /** Sets `emoji`, or takes it back when it is already the caller's (`pick` sets it even then). */
  async function choose(emoji: string, pick = false) {
    setBusy(true);
    const next = mine === emoji && !pick ? null : emoji;
    const done =
      next === null
        ? await outcome(unreact({ path: { postId: post.postId } }), 204)
        : await outcome(react({ path: { postId: post.postId }, body: { emoji: next } }), 204);
    if (done.ok) setMine(next);
    setBusy(false);
  }
  return { mine, busy, count, total, emojis, choose };
}
