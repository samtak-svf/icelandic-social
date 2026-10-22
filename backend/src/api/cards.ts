import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, INVALID, OpaqueId, PhotoVersion } from "./common.ts";
import { Author, Media } from "./social.ts";

// Typed references to a community's content and the cards they show when
// shared (#288), in a conversation or anywhere else. A reference is only a
// kind and an id; resolving it asks the same access checks as reading the
// thing itself, so content the caller may no longer see, for whatever reason,
// resolves to a card that says only that it is not available.

/** How many references one call resolves. */
const MAX_REFS = 50;

/** The longest excerpt a card shows of a text, in characters. */
export const EXCERPT_LENGTH = 280;

export const REF_KINDS = ["post", "comment", "community"] as const;

const Ref = z
  .object({ kind: z.enum(REF_KINDS), id: OpaqueId })
  .openapi("Ref", { description: "A stable reference to a post, a comment or a community" });

const CardCommunity = z.object({
  communityId: OpaqueId,
  name: z.string(),
  photo: PhotoVersion.openapi({
    description:
      "The community's picture version, as on Community; null when it has none (decision 0080)",
  }),
});
const Excerpt = z.string().openapi({
  description: `The text's first ${EXCERPT_LENGTH} characters, an ellipsis ending one cut short`,
});
const CreatedAt = z.int().openapi({ description: "Unix milliseconds" });

const Card = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("unavailable"), ref: Ref }),
    z.object({
      kind: z.literal("post"),
      ref: Ref,
      community: CardCommunity,
      author: Author,
      excerpt: Excerpt,
      image: z.union([Media, z.null()]),
      createdAt: CreatedAt,
    }),
    z.object({
      kind: z.literal("comment"),
      ref: Ref,
      community: CardCommunity,
      postId: OpaqueId,
      author: Author,
      excerpt: Excerpt,
      createdAt: CreatedAt,
    }),
    z.object({
      kind: z.literal("community"),
      ref: Ref,
      community: CardCommunity,
      description: z.string(),
      audience: z.enum(["open", "private"]),
      memberCount: z.int().nullable(),
    }),
  ])
  .openapi("Card", {
    description:
      "What a reference shows, by its kind; `unavailable` when the caller may not see it",
  });

export const resolveCardsRoute = createRoute({
  method: "post",
  path: "/v1/cards",
  operationId: "resolveCards",
  tags: ["social"],
  summary: "Resolve references to cards",
  description:
    "The card of each reference, in the order given. A reference to what the caller may not see, or to nothing, resolves to an `unavailable` card, whatever the reason.",
  security: ACCOUNT,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ refs: z.array(Ref).min(1).max(MAX_REFS) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The cards",
      content: { "application/json": { schema: z.object({ cards: z.array(Card) }) } },
    },
    ...INVALID,
    ...AUTHED,
  },
});
