import { describe, expect, it } from "vitest";
import { canSendComment, commentMedia } from "./comment-draft.ts";

describe("canSendComment", () => {
  it("sends text alone, an image alone, or both", () => {
    expect(canSendComment({ text: "Hæ", hasImage: false, busy: false })).toBe(true);
    expect(canSendComment({ text: "", hasImage: true, busy: false })).toBe(true);
    expect(canSendComment({ text: "  ", hasImage: true, busy: false })).toBe(true);
    expect(canSendComment({ text: "Hæ", hasImage: true, busy: false })).toBe(true);
  });

  it("refuses an empty comment and one being sent", () => {
    expect(canSendComment({ text: " \n", hasImage: false, busy: false })).toBe(false);
    expect(canSendComment({ text: "Hæ", hasImage: true, busy: true })).toBe(false);
  });
});

describe("commentMedia", () => {
  it("names the uploaded image, or nothing", () => {
    expect(commentMedia("m1")).toEqual(["m1"]);
    expect(commentMedia(null)).toEqual([]);
  });
});
