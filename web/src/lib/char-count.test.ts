import { describe, expect, it } from "vitest";
import vectors from "../../../api/text-length.vectors.json" with { type: "json" };
import { clipText, textLength } from "./char-count.ts";

describe("the shared text length vectors", () => {
  it.each(vectors.lengths)("counts: $note", ({ text, codePoints }) => {
    expect(textLength(text)).toBe(codePoints);
  });

  it.each(vectors.clips)("clips: $note", ({ text, limit, clipped }) => {
    expect(clipText(text, limit)).toBe(clipped);
  });
});
