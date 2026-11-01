import { z } from "@hono/zod-openapi";
import { LIMITS } from "../limits.gen.ts";
import { OpaqueId } from "./common.ts";
import { POLL_OPTIONS } from "./poll-schema.ts";

// What a post is made of, shared by the routes of a community and of a wall.

/** How many images a post holds. */
export const MAX_POST_MEDIA = LIMITS.postMediaCount;

/** How long a post's text is, in characters. */
const MAX_POST_BODY = LIMITS.postBodyChars;

/** The longest bio, in characters (decision 0115). */
export const MAX_BIO = LIMITS.bioChars;

export const MediaId = OpaqueId.openapi({ example: "sm_3f9a1b2c3d4e5f60718293a4b5c6d7e8" });

/** Who reads a wall post besides its author (decision 0115). */
export const WallAudience = z.enum(["friends", "everyone"]).openapi("WallAudience");

/** What a post is made of, in a community and on a wall. */
export const POST_FIELDS = {
  body: z.string().trim().max(MAX_POST_BODY).default(""),
  media: z.array(MediaId).max(MAX_POST_MEDIA).default([]),
  poll: z
    .object({
      options: z
        .array(z.string().trim().min(1).max(POLL_OPTIONS.textMax))
        .min(POLL_OPTIONS.min)
        .max(POLL_OPTIONS.max),
    })
    .optional()
    .openapi({
      description:
        "Makes the post a poll (decision 0090): the body is the question and is required, there are two to six distinct options, and no image",
    }),
};
