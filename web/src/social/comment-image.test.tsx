import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import { CommentImage } from "./comment-image.tsx";

// The browser behaviour (the fetch, the dialog, Esc, focus) is e2e/; under
// Node there is no DOM, so this holds what the server render shows.
describe("CommentImage", () => {
  const media = { mediaId: "m1", width: 640, height: 480 };

  it("shows the image's box at the bubble's width, as a button that opens it", () => {
    const html = renderToStaticMarkup(<CommentImage postId="p1" media={media} />);
    expect(html).toContain(`aria-label="${strings.comment_image_alt}"`);
    expect(html).toContain("<button");
    expect(html).toContain("aspect-ratio:640 / 480");
    expect(html).toContain("w-full");
  });
});
