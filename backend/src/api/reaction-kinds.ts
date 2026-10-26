import { z } from "@hono/zod-openapi";
import { Emoji } from "./emoji.ts";

/**
 * The five kinds a post reaction had before it became any one emoji (decision
 * 0100). A build below 0.16.0 still sends and reads them, so they stay as an
 * alias of an emoji on the way in and as derived fields on the way out; they
 * go once the client floor passes 0.16.0.
 */
export const REACTIONS = ["like", "love", "laugh", "wow", "sad"] as const;

export type ReactionKind = (typeof REACTIONS)[number];

const KIND_EMOJI: Record<ReactionKind, string> = {
  like: "👍",
  love: "❤️",
  laugh: "😂",
  wow: "😮",
  sad: "😢",
};

/** The emoji an old kind is stored as. */
export const emojiOfKind = (kind: ReactionKind): string => KIND_EMOJI[kind];

/** The old kind an emoji counts as, or null when it has none. */
export const kindOfEmoji = (emoji: string): ReactionKind | null =>
  REACTIONS.find((kind) => KIND_EMOJI[kind] === emoji) ?? null;

const Reaction = z.enum(REACTIONS);

export const ReactionBody = z
  .object({
    emoji: Emoji.optional().openapi({ description: "Any one emoji (decision 0100)" }),
    kind: Reaction.optional().openapi({
      deprecated: true,
      description:
        "Deprecated: one of the five old kinds, stored as its emoji. For a build below 0.16.0; send `emoji`",
    }),
  })
  .refine((body) => (body.emoji === undefined) !== (body.kind === undefined), {
    message: "exactly one of emoji and kind",
  });

/** The reaction fields of a post: the old kinds and the emoji (decision 0100). */
export const ReactionFields = {
  reactions: z.array(z.object({ kind: Reaction, count: z.int() })).openapi({
    deprecated: true,
    description:
      "Deprecated: use `emojis`. Counts of the five old kinds, derived from the emoji; any other emoji is absent. Removed once the client floor passes 0.16.0 (0100)",
  }),
  myReaction: Reaction.nullable().openapi({
    deprecated: true,
    description: "Deprecated: use `myEmoji`. Its old kind, null when it has none (0100)",
  }),
  emojis: z.array(z.object({ emoji: Emoji, count: z.int() })).openapi({
    description:
      "Each emoji the caller can see on the post, with its count: most used first, equal counts in code point order (decision 0100)",
  }),
  myEmoji: Emoji.nullable().openapi({ description: "The caller's own reaction, if any" }),
};
