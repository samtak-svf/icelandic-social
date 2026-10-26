import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { Post } from "../generated/api.ts";
import { FeaturedList, FeaturedStrip, feedItemClass } from "./featured.tsx";

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
  anonymous: false,
  mine: false,
  body: `Færsla númer ${n}`,
  media: [],
  createdAt: n,
  reactions: [],
  myReaction: null,
  emojis: [],
  myEmoji: "",
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

  it("names no author on an anonymous post", () => {
    const anonymous: Post = { ...post(4), anonymous: true, author: null };
    const html = renderToStaticMarkup(<FeaturedStrip featured={[anonymous]} />);
    expect(html).toContain(strings.post_anonymous_author);
    expect(html).not.toContain("Höfundur 4");
    expect(html).not.toContain(strings.person_deleted);
    const mine = renderToStaticMarkup(
      <FeaturedStrip featured={[{ ...anonymous, mine: true, author: post(4).author }]} />,
    );
    expect(mine).toContain(strings.post_anonymous_mine);
    expect(mine).not.toContain("Höfundur 4");
  });

  it("is a stacked list under the heading in the aside", () => {
    const html = renderToStaticMarkup(<FeaturedList featured={[post(1), post(2), post(3)]} />);
    expect(html).toContain(`<h3 class="font-semibold">${strings.community_featured}</h3>`);
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).not.toContain("overflow-x-auto");
  });

  it("leave the feed on an expanded window only, by the featured list", () => {
    const featured = [post(2)];
    expect(feedItemClass("p2", featured)).toBe("expanded:hidden");
    expect(feedItemClass("p1", featured)).toBeUndefined();
    // Released: the list no longer has it, so the post is back in its place.
    expect(feedItemClass("p2", [])).toBeUndefined();
  });
});
