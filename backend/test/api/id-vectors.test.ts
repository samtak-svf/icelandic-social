import { describe, expect, it } from "vitest";
import vectors from "../../../api/id.vectors.json" with { type: "json" };
import { OpaqueId } from "../../src/api/common.ts";

// The vectors are shared with the core (#499): what `is_id` takes is what the API takes.
describe("the shared id vectors", () => {
  it.each(vectors.cases)("$note", ({ text, valid }) => {
    expect(OpaqueId.safeParse(text).success).toBe(valid);
  });
});
