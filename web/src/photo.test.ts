import { describe, expect, it } from "vitest";
import { masterSize, MASTER_EDGE } from "./photo.ts";

describe("masterSize", () => {
  it("scales the long edge down to 2400 and keeps the ratio", () => {
    expect(masterSize(4800, 3600)).toEqual({ w: MASTER_EDGE, h: 1800 });
    expect(masterSize(3000, 6000)).toEqual({ w: 1200, h: MASTER_EDGE });
  });

  it("never upscales", () => {
    expect(masterSize(640, 480)).toEqual({ w: 640, h: 480 });
    expect(masterSize(MASTER_EDGE, 100)).toEqual({ w: MASTER_EDGE, h: 100 });
  });

  it("keeps a thin image at least one pixel on its short edge", () => {
    expect(masterSize(24000, 3).h).toBe(1);
  });
});
