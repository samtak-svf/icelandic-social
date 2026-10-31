import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { feedPhase } from "./post-feed.tsx";
import { PostView } from "./post.tsx";
import { mayPostIn, noPostNotice } from "./roles.tsx";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => undefined,
  Link: ({
    children,
    to,
    className,
    ...rest
  }: {
    children?: ReactNode;
    to: string;
    className?: string;
    "aria-describedby"?: string;
  }) => (
    <a href={to} className={className} aria-describedby={rest["aria-describedby"]}>
      {children}
    </a>
  ),
}));

// A card reads the signed-in account for its menu.
vi.mock("../account.tsx", () => ({
  useAccount: () => ({
    state: { status: "signed-out" },
    refresh: () => Promise.resolve(),
  }),
  useMe: () => null,
}));

const problem: Problem = { kind: "unreachable" };

describe("feedPhase", () => {
  it("loads until the first page has answered", () => {
    expect(feedPhase(null, false, null)).toBe("loading");
    expect(feedPhase(null, true, null)).toBe("loading");
  });

  it("is a problem when the first page failed", () => {
    expect(feedPhase(null, false, problem)).toBe("problem");
  });

  it("lists what is held", () => {
    expect(feedPhase([1], true, null)).toBe("list");
    expect(feedPhase([1], false, null)).toBe("list");
  });

  it("is empty only at the end of the list", () => {
    expect(feedPhase([], false, null)).toBe("empty");
  });

  it("keeps loading through an empty page that has more after it", () => {
    expect(feedPhase([], true, null)).toBe("loading");
  });

  it("reports a failure on the way through an empty page, not an empty feed", () => {
    expect(feedPhase([], true, problem)).toBe("problem");
  });
});

describe("mayPostIn", () => {
  const now = Date.now();
  const roles = ["owner", "moderator", "member"] as const;

  it.each(roles)("lets a %s write in a community that is not read-only", (role) => {
    expect(mayPostIn({ role, mutedUntil: null, readOnly: false })).toBe(true);
    expect(mayPostIn({ role, mutedUntil: now - 1000, readOnly: false })).toBe(true);
    expect(noPostNotice({ role, mutedUntil: null, readOnly: false })).toBeNull();
  });

  it.each(roles)("stops a %s in a read-only community, and says why", (role) => {
    expect(mayPostIn({ role, mutedUntil: null, readOnly: true })).toBe(false);
    expect(noPostNotice({ role, mutedUntil: null, readOnly: true })).toBe(
      strings.community_read_only,
    );
  });

  it("gives a muted member in a read-only community the reason that outlasts the mute", () => {
    const standing = { role: "member", mutedUntil: now + 60_000, readOnly: true } as const;
    expect(noPostNotice(standing)).toBe(strings.community_read_only);
  });

  it("is not a person who has not joined, who is told nothing", () => {
    for (const readOnly of [false, true]) {
      expect(mayPostIn({ role: null, mutedUntil: null, readOnly })).toBe(false);
      expect(noPostNotice({ role: null, mutedUntil: null, readOnly })).toBeNull();
    }
  });

  it("is not a member muted for now, who is told so", () => {
    const standing = { role: "member", mutedUntil: now + 60_000, readOnly: false } as const;
    expect(mayPostIn(standing)).toBe(false);
    expect(noPostNotice(standing)).toBe(strings.community_muted);
  });
});

const live = (over: Partial<Post> = {}): Post => ({
  postId: "p1",
  communityId: "c1",
  author: { accountId: "a1", name: "Höfundur Prófsson", verified: true, photo: null, role: null },
  anonymous: false,
  mine: false,
  body: "Texti pósts",
  media: [],
  createdAt: 1_700_000_000_000,
  reactions: [],
  myReaction: null,
  emojis: [],
  myEmoji: "",
  commentCount: 0,
  latestComment: null,
  state: "visible",
  pinned: false,
  ...over,
});

const draw = (post: Post, community?: { communityId: string; name: string; photo: null }) =>
  renderToStaticMarkup(
    <PostView
      post={post}
      linked={true}
      deleted={() => undefined}
      changed={() => undefined}
      moderates={false}
      community={community}
    />,
  );

describe("a post card in the feed", () => {
  const community = { communityId: "c1", name: "Garðyrkjufélagið", photo: null };

  it("names the community before the author", () => {
    const html = draw(live(), community);
    // The article's own label names the author; the heading is what comes after the header opens.
    const heading = html.slice(html.indexOf("<header"));
    expect(heading).toContain("Garðyrkjufélagið");
    expect(heading.indexOf("Garðyrkjufélagið")).toBeLessThan(heading.indexOf("Höfundur"));
    expect(html).toContain('href="/communities/$communityId"');
  });

  it("names no community inside one", () => {
    const html = draw(live());
    expect(html).not.toContain("Garðyrkjufélagið");
    expect(html).not.toContain('href="/communities/$communityId"');
  });

  it("names no community on a wall post, whatever the caller passes", () => {
    const html = draw(live({ wall: { accountId: "a1" } }), community);
    expect(html).not.toContain("Garðyrkjufélagið");
  });

  it("runs to the screen's edges on a phone and is a box from medium up", () => {
    const html = draw(live());
    expect(html).toMatch(
      /<article[^>]*class="-mx-4 [^"]*rounded-none[^"]*medium:mx-0[^"]*medium:border"/,
    );
  });
});

describe("the counts in the action pills", () => {
  it("draws the number inside the pill and describes it by the whole phrase", () => {
    const html = draw(live({ commentCount: 3 }));
    expect(html).toContain('<span aria-hidden="true">3</span>');
    expect(html).toContain(strings.post_comments({ count: 3 }));
    const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(described).toBeDefined();
    expect(html).toContain(`id="${described}"`);
  });

  it("draws no number and no description for zero", () => {
    const html = draw(live());
    expect(html).not.toContain('aria-hidden="true">0<');
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain(strings.post_comments({ count: 0 }));
  });
});
