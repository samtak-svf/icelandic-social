import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import vectors from "../../../api/poll.vectors.json" with { type: "json" };
import { POST_FIELDS } from "../../src/api/post-fields.ts";
import { invalidPost } from "../../src/modules/social/wall-routes.ts";

// The vectors are shared with the core and the web (#494): what a form lets
// through here is what the server takes.
const fields = z.object(POST_FIELDS);

describe("the shared poll vectors", () => {
  it.each(vectors.cases)("$note", ({ question, options, valid }) => {
    const parsed = fields.safeParse({ body: question, poll: { options } });
    expect(parsed.success && !invalidPost(parsed.data)).toBe(valid);
  });
});
