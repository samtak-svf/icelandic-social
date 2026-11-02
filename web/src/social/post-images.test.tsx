import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import { LIMITS } from "../generated/limits.ts";
import { Images } from "./post.tsx";

// A post holding more images than it shows (decision 0127). The bug each test names: all of them in
// the feed, a post that hides the rest without saying so, and a count read out over the image's own.

vi.mock("@tanstack/react-router", () => ({ Link: () => null, useNavigate: () => () => {} }));
vi.mock("./viewer.tsx", () => ({
  useMediaSrc: (_postId: string, mediaId: string) => `/${mediaId}`,
  useViewer: () => ({ open: () => {}, viewer: null }),
}));

const media = (count: number) =>
  Array.from({ length: count }, (_, n) => ({ mediaId: `m${n}`, width: 80, height: 60 }));
const render = (count: number) => renderToStaticMarkup(<Images postId="p" media={media(count)} />);
const shownImages = (html: string) => [...html.matchAll(/<img /g)].length;

describe("a post's images", () => {
  it("shows as many as a post shows, and says how many more on the last", () => {
    const html = render(6);
    expect(shownImages(html)).toBe(LIMITS.postImagesShown);
    expect(html).toContain(strings.post_image_alt_numbered({ n: 4, count: 6 }));
    expect(html).not.toContain(strings.post_image_alt_numbered({ n: 5, count: 6 }));
    expect(html).toMatch(/aria-hidden="true"[^>]*>\+2</);
  });

  it("says nothing more when it shows them all", () => {
    const html = render(LIMITS.postImagesShown);
    expect(shownImages(html)).toBe(LIMITS.postImagesShown);
    expect(html).not.toContain("aria-hidden");
  });
});
