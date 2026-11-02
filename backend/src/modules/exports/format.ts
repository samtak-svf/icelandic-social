import type { ParsedItem } from "../imports/index.ts";
import type { ExportComment, ExportImage, ExportPost } from "../social/index.ts";
import type { Counts } from "./checkpoint.ts";

// The records of a person's own export (decision 0126), described field by field in
// docs/export-format.md. Keys are English and stable; a change to them is a new
// `format_version`. Dates are ISO 8601 in UTC, with the epoch milliseconds beside.

/** The version of the layout `export.json` names. */
const FORMAT_VERSION = 1;

const iso = (ms: number) => new Date(ms).toISOString();

export const imagePath = (spaceId: string, mediaId: string) =>
  `spaces/${spaceId}/images/${mediaId}.webp`;

export type ExportPostRecord = {
  id: string;
  created_at: string;
  created_at_ms: number;
  body: string;
  audience: string | null;
  state: string;
  anonymous: boolean;
  imported: boolean;
  images: string[];
  images_withheld?: true;
  poll?: { options: { id: string; text: string }[]; my_vote: string | null };
};

/** The fields the file's post record carries, for the importer map below. */
export type ExportPostFields = Pick<ExportPostRecord, "id" | "created_at" | "body" | "images">;

const split = (spaceId: string, images: ExportImage[]) => ({
  images: images.filter((i) => !i.withheld).map((i) => imagePath(spaceId, i.mediaId)),
  withheld: images.some((i) => i.withheld),
});

export function postRecord(spaceId: string, post: ExportPost): ExportPostRecord {
  const { images, withheld } = split(spaceId, post.images);
  return {
    id: post.postId,
    created_at: iso(post.createdAt),
    created_at_ms: post.createdAt,
    body: post.body,
    audience: post.audience,
    state: post.state,
    anonymous: post.anonymous,
    imported: post.imported,
    images,
    ...(withheld ? { images_withheld: true as const } : {}),
    ...(post.poll
      ? {
          poll: {
            options: post.poll.options.map((o) => ({ id: o.optionId, text: o.text })),
            my_vote: post.poll.myOption,
          },
        }
      : {}),
  };
}

export function commentRecord(spaceId: string, comment: ExportComment) {
  const { images, withheld } = split(spaceId, comment.images);
  return {
    id: comment.commentId,
    post_id: comment.postId,
    parent_comment_id: comment.parentCommentId,
    created_at: iso(comment.createdAt),
    created_at_ms: comment.createdAt,
    body: comment.body,
    state: comment.state,
    images,
    ...(withheld ? { images_withheld: true as const } : {}),
  };
}

export type ReactionRecord =
  | {
      type: "post_reaction";
      post_id: string;
      emoji: string;
      created_at: string;
      created_at_ms: number;
    }
  | { type: "comment_like"; comment_id: string; created_at: string; created_at_ms: number }
  | { type: "poll_vote"; post_id: string; option_id: string };

export function reactionRecord(
  stage: "reactions" | "comment_reactions" | "votes",
  row: { id: string; emoji?: string; createdAt?: number; optionId?: string },
): ReactionRecord {
  if (stage === "votes")
    return { type: "poll_vote", post_id: row.id, option_id: row.optionId ?? "" };
  const at = { created_at: iso(row.createdAt ?? 0), created_at_ms: row.createdAt ?? 0 };
  return stage === "reactions"
    ? { type: "post_reaction", post_id: row.id, emoji: row.emoji ?? "", ...at }
    : { type: "comment_like", comment_id: row.id, ...at };
}

/**
 * Where each field of a post in another platform's export file lands in ours (decision 0126:
 * "at least as good as what we accept"). `satisfies` makes a field the importer learns a
 * type error here until it is mapped, or named as one we hold none of (`null`).
 */
export const fromImport = {
  id: "id",
  at: "created_at",
  body: "body",
  images: "images",
  // We hold no video: a post's video is not stored, so the export has nothing to carry.
  hasVideo: null,
  class: null,
  foreignImages: null,
  needsImages: null,
} satisfies Record<keyof ParsedItem, keyof ExportPostFields | null>;

export const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));

/** What the file says it leaves out, so a reader need not guess. */
const LEFT_OUT = [
  "messages and chat media: only the devices can read them",
  "other people's content, including comments others wrote on your posts",
  "kennitala and phone number",
  "images a moderator took down, and images of removed or hidden posts and comments",
];

export function summary(exportId: string, accountId: string, createdAt: number, counts: Counts) {
  return {
    format_version: FORMAT_VERSION,
    export_id: exportId,
    account_id: accountId,
    created_at: iso(createdAt),
    created_at_ms: createdAt,
    counts,
    left_out: LEFT_OUT,
  };
}
