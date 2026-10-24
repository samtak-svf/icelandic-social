import { describe, expect, it } from "vitest";
import vectors from "../../../api/frames.vectors.json" with { type: "json" };
import { overrideRect, placeFrame } from "./frames.ts";

// The web places frames with the backend's rule, generated (tooling/web-api.mjs),
// so the shared vectors of decision 0086 hold here too.
describe("the generated placing rule", () => {
  for (const v of vectors.place) {
    it(v.name, () => {
      expect(placeFrame(v.imageW, v.imageH, v.aspectW, v.aspectH, v.focus)).toEqual(v.expected);
    });
  }
  for (const v of vectors.override) {
    it(v.name, () => {
      expect(overrideRect(v.imageW, v.imageH, v.rect)).toEqual(v.expected);
    });
  }
});
