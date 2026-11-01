import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import vectors from "../../../api/text-length.vectors.json" with { type: "json" };

// The vectors are shared with the core, the web and the apps (decision 0123). A
// client that counts as they say takes what this validator takes: every text
// limit in the contract is a zod `.max()`, and a raised zod that counted another
// way would fail here before it refused a person's text.
describe("the shared text length vectors", () => {
  it.each(vectors.lengths)("$note", ({ text, codePoints }) => {
    expect(z.string().max(codePoints).safeParse(text).success).toBe(true);
    if (codePoints > 0)
      expect(
        z
          .string()
          .max(codePoints - 1)
          .safeParse(text).success,
      ).toBe(false);
  });
});
