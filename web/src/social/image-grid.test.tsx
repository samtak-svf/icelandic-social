import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { CommunityImage } from "../generated/api.ts";
import { ImageGrid } from "./image-grid.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    className,
  }: {
    children: ReactNode;
    params: { postId: string };
    className?: string;
  }) => (
    <a className={className} href={`/posts/${params.postId}`}>
      {children}
    </a>
  ),
}));
vi.mock("./viewer.tsx", () => ({ useMediaSrc: () => null }));

const image = (n: number): CommunityImage => ({
  mediaId: `m${n}`,
  postId: `p${n}`,
  commentId: null,
  width: 100,
  height: 100,
  createdAt: n,
});

describe("the image grid", () => {
  it("says so when there are no images", () => {
    const html = renderToStaticMarkup(<ImageGrid images={[]} />);
    expect(html).toContain(strings.community_images_empty);
    expect(html).not.toContain("<ul");
  });

  it("links each image to its post and keeps the order it was given", () => {
    const html = renderToStaticMarkup(<ImageGrid images={[image(3), image(2), image(1)]} />);
    expect([...html.matchAll(/href="(\/posts\/[^"]+)"/g)].map((m) => m[1])).toEqual([
      "/posts/p3",
      "/posts/p2",
      "/posts/p1",
    ]);
    expect(html).toContain("grid-cols-3");
  });

  it("ends in the sentinel only when asked to page", () => {
    expect(renderToStaticMarkup(<ImageGrid images={[image(1)]} />)).not.toContain("h-px");
    expect(renderToStaticMarkup(<ImageGrid images={[image(1)]} sentinel={() => {}} />)).toContain(
      "h-px",
    );
  });
});
