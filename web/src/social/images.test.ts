import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, refusal } from "./images.ts";

const image = (size = 1000) => ({ size });

describe("refusal", () => {
  it("takes up to four images of up to 10 MB", () => {
    expect(refusal(0, [image()])).toBeNull();
    expect(refusal(0, [image(), image(), image(), image(MAX_IMAGE_BYTES)])).toBeNull();
    expect(refusal(3, [image()])).toBeNull();
  });

  it("refuses a fifth image, chosen at once or after others", () => {
    expect(refusal(0, [image(), image(), image(), image(), image()])).toBe("too_many");
    expect(refusal(4, [image()])).toBe("too_many");
    expect(refusal(2, [image(), image(), image()])).toBe("too_many");
  });

  it("refuses an image over 10 MB", () => {
    expect(refusal(0, [image(MAX_IMAGE_BYTES + 1)])).toBe("too_large");
    expect(refusal(1, [image(), image(MAX_IMAGE_BYTES + 1)])).toBe("too_large");
  });
});
