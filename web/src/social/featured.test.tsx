import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { Post } from "../generated/api.ts";
import { FeaturedList, FeaturedStrip } from "./featured.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));

// Under Node there is no router or DOM; `Link` is stubbed so the server render
// shows the cards. The browser behaviour is e2e/.
const post = (n: number): Post => ({
  postId: `p${n}`,
  communityId: "cm1",
  author: { accountId: `a${n}`, name: `Höfundur ${n}`, verified: false, photo: null, role: null },
  body: `Færsla númer ${n}`,
  media: [],
  createdAt: n,
  reactions: [],
  myReaction: null,
  commentCount: 0,
  latestComment: null,
  state: "visible",
  pinned: true,
});

describe("featured posts", () => {
  it("draw nothing for none", () => {
    expect(renderToStaticMarkup(<FeaturedStrip featured={[]} />)).toBe("");
    expect(renderToStaticMarkup(<FeaturedList featured={[]} />)).toBe("");
  });

  it("is a scrolling row below expanded and hidden on an expanded window", () => {
    const html = renderToStaticMarkup(<FeaturedStrip featured={[post(1), post(2)]} />);
    expect(html).toContain(strings.community_featured);
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("expanded:hidden");
    expect(html).toContain("Færsla númer 1");
    expect(html).toContain("Höfundur 2");
  });

  it("is a stacked list under the heading in the aside", () => {
    const html = renderToStaticMarkup(<FeaturedList featured={[post(1), post(2), post(3)]} />);
    expect(html).toContain(`<h3 class="font-semibold">${strings.community_featured}</h3>`);
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).not.toContain("overflow-x-auto");
  });
});
