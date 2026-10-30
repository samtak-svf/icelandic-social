import { strings } from "../generated/brand/strings.ts";

// The sentence and badge of a notification row (decisions 0103, 0104), chosen
// by the rule in api/presentation.vectors.json that Android and iOS follow:
// one actor reads plain, two read `_two`, three or more `_many` with the
// others counted. A null name is a deleted account.

type NoticeKind = "comment" | "reply" | "reaction" | "join_approved" | "moderated";
export type NoticeBadge = "emoji" | "comment" | "approved" | "moderator";

export interface NoticeSource {
  kind: NoticeKind;
  action: string | null;
  /** The newest actors first; null or a null name is a deleted account. */
  actors: ReadonlyArray<{ name: string | null } | null>;
  actorCount: number;
}

export interface NoticeText {
  key: string;
  args: { name?: string | null; other?: string | null; count?: number };
  badge: NoticeBadge;
  text: string;
}

type Who = { name: string };
type Pair = Who & { other: string };
type Many = Who & { count: number };

const GROUPED = {
  comment: [strings.notice_comment, strings.notice_comment_two, strings.notice_comment_many],
  reply: [strings.notice_reply, strings.notice_reply_two, strings.notice_reply_many],
  reaction: [strings.notice_reaction, strings.notice_reaction_two, strings.notice_reaction_many],
} as const;

const BADGE: Record<NoticeKind, NoticeBadge> = {
  comment: "comment",
  reply: "comment",
  reaction: "emoji",
  join_approved: "approved",
  moderated: "moderator",
};

/** The moderated rows with a sentence of their own; any other action reads `notice_moderated`. */
const MODERATED: Partial<
  Record<
    string,
    | "notice_anonymous_declined"
    | "notice_review_upheld"
    | "notice_review_overturned"
    | "notice_account_photo_cleared"
  >
> = {
  decline_anonymous_post: "notice_anonymous_declined",
  review_upheld: "notice_review_upheld",
  review_overturned: "notice_review_overturned",
  clear_account_photo: "notice_account_photo_cleared",
};

/** The strings key, its arguments, the badge and the finished sentence of a row. */
export function noticeText(n: NoticeSource): NoticeText {
  const badge = BADGE[n.kind];
  if (n.kind === "join_approved") {
    return { key: "notice_join_approved", args: {}, badge, text: strings.notice_join_approved };
  }
  if (n.kind === "moderated") {
    const key = MODERATED[n.action ?? ""] ?? "notice_moderated";
    return { key, args: {}, badge, text: strings[key] };
  }
  const names = n.actors.map((actor) => actor?.name ?? null);
  const name = names[0] ?? null;
  const shown = (value: string | null) => value ?? strings.person_deleted;
  const [one, two, many] = GROUPED[n.kind] as readonly [
    (a: Who) => string,
    (a: Pair) => string,
    (a: Many) => string,
  ];
  const stem = `notice_${n.kind}`;
  if (n.actorCount >= 3) {
    const count = n.actorCount - 1;
    return {
      key: `${stem}_many`,
      args: { name, count },
      badge,
      text: many({ name: shown(name), count }),
    };
  }
  if (n.actorCount === 2) {
    const other = names[1] ?? null;
    return {
      key: `${stem}_two`,
      args: { name, other },
      badge,
      text: two({ name: shown(name), other: shown(other) }),
    };
  }
  return { key: stem, args: { name }, badge, text: one({ name: shown(name) }) };
}
