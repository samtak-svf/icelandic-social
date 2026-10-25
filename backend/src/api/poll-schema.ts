import { z } from "@hono/zod-openapi";
import { OpaqueId } from "./common.ts";

// What a poll is on the wire (decision 0090). Split from social.ts so the
// routes in polls.ts can import both without a cycle.

/** The bounds of a poll's options and their text (decision 0090). */
export const POLL_OPTIONS = { min: 2, max: 6, textMax: 80 } as const;

export const OptionId = OpaqueId.openapi({ example: "o0" });

export const Poll = z
  .object({
    options: z.array(
      z.object({
        optionId: OpaqueId,
        text: z.string(),
        votes: z.int().nullable().openapi({
          description:
            "How many votes the option has, or null while the caller has not voted: the author, the community's owner and moderators, and every reader of a closed poll see it at once (decision 0090)",
        }),
      }),
    ),
    total: z.int().openapi({ description: "How many votes the poll has, always shown" }),
    mine: OpaqueId.nullable().openapi({ description: "The option the caller voted for" }),
    closed: z.boolean(),
  })
  .openapi("Poll", {
    description:
      "A poll's options and counts (decision 0090). No field and no route says who voted or how",
  });
