import { Link } from "@tanstack/react-router";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Item, Person } from "../generated/core.d.ts";
import { listStamp } from "../lib/is-format.ts";
import { Avatar } from "../social/avatar.tsx";
import { VerifiedMark } from "../ui/kit.tsx";
import { conversationTitle, isGroup, previewLine, readLine } from "./people.ts";

/**
 * One conversation in the list, as the apps draw it: the avatar, the title
 * with a verified mark for a 1:1, the preview or "typing", and on the right
 * the muted mark, the stamp and the unread count. Unread and not muted, the
 * row is tinted.
 */
export function ConversationRow({
  conversation,
  typing,
  now,
}: Readonly<{ conversation: Conversation; typing: boolean; now: number }>) {
  const { last, unread } = conversation;
  const group = isGroup(conversation);
  const title = conversationTitle(conversation);
  const muted = conversation.mute.kind !== "off";
  const face = rowFace(conversation, group);
  return (
    <Link
      to="/conversations/$conversationId"
      params={{ conversationId: conversation.id }}
      className={`flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-muted ${
        unread > 0 && !muted ? "bg-primary-subtle" : ""
      }`}
    >
      <Avatar
        kind="person"
        id={face?.account ?? conversation.id}
        name={face === null ? title : face.name}
        photo={face?.photo ?? null}
        className="size-11 rounded-full text-base"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <RowTitle title={title} bold={unread > 0} verified={face?.verified === true} />
        {typing ? (
          <span className="truncate text-sm text-primary">{strings.typing_in_row}</span>
        ) : (
          last !== null && <Preview item={last} group={group} />
        )}
      </span>
      <RowSide last={last} unread={unread} muted={muted} now={now} />
    </Link>
  );
}

/** A group's circle carries the group's title, a 1:1's the other person. */
function rowFace(conversation: Conversation, group: boolean): Person | null {
  const [only] = conversation.members;
  return group || only === undefined ? null : only;
}

/** The title, black while unread, with the verified mark for a 1:1. */
function RowTitle({
  title,
  bold,
  verified,
}: Readonly<{ title: string; bold: boolean; verified: boolean }>) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`truncate ${bold ? "font-black" : "font-semibold"}`}>{title}</span>
      {verified && <VerifiedMark className="shrink-0 text-xs" />}
    </span>
  );
}

/** The right side: the muted mark and the stamp, the unread count under them. */
function RowSide({
  last,
  unread,
  muted,
  now,
}: Readonly<{ last: Item | null; unread: number; muted: boolean; now: number }>) {
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <span className="flex items-center gap-1 text-xs text-muted-fg">
        {muted && <BellOff />}
        {last !== null && (
          <span>{listStamp(last.receivedAt ?? last.ts, now, strings.day_yesterday)}</span>
        )}
      </span>
      {unread > 0 && <UnreadPill count={unread} muted={muted} />}
    </span>
  );
}

/**
 * The last item: a clock while one's own is sending, the failed mark, the
 * line, and who read one's own (0022): "Lesin" in a 1:1, the count in a group.
 */
function Preview({ item, group }: Readonly<{ item: Item; group: boolean }>) {
  const read = item.own && item.status === "sent" && item.readBy > 0;
  return (
    <span className="flex min-w-0 items-center gap-1 text-sm text-muted-fg">
      {item.own && item.status === "pending" && (
        <>
          <Clock />
          <span className="sr-only">{strings.message_sending}</span>
        </>
      )}
      {item.own && item.status === "failed" && (
        <span className="shrink-0 text-danger">{strings.message_failed}</span>
      )}
      <span className="truncate">{previewLine(item, group)}</span>
      {read && <span className="shrink-0">· {readLine(item.readBy, group)}</span>}
    </span>
  );
}

/** The count in a pill, grey when muted; a screen reader hears the words. */
function UnreadPill({ count, muted }: Readonly<{ count: number; muted: boolean }>) {
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold ${
        muted ? "bg-muted text-muted-fg" : "bg-primary text-primary-fg"
      }`}
    >
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{strings.unread_count({ count })}</span>
    </span>
  );
}

function Clock() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 fill-none stroke-current"
    >
      <circle cx="8" cy="8" r="6.5" strokeWidth="1.5" />
      <path d="M8 4.5V8l2.5 1.5" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BellOff() {
  return (
    <span className="inline-flex">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current">
        <path
          d="M6.5 13.5a1.6 1.6 0 0 0 3 0M4 11.5h8.5M4.5 6.5a3.5 3.5 0 0 1 6-2.4M11.5 7v2.5l1 2M4.5 6.5v3l-1 2M2 2l12 12"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">{strings.muted}</span>
    </span>
  );
}
