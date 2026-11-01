import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { feedPhase } from "./post-feed.tsx";
import { PostView } from "./post.tsx";
import { mayPostIn, mayReplyTo, noPostNotice, postStanding } from "./roles.tsx";

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

const draw = (
  post: Post,
  community?: { communityId: string; name: string; photo: null },
  mayReply = true,
  linked = true,
) =>
  renderToStaticMarkup(
    <PostView
      post={post}
      linked={linked}
      deleted={() => undefined}
      changed={() => undefined}
      moderates={false}
      mayReply={mayReply}
      community={community}
    />,
  );

describe("who may reply to a post", () => {
  const member = { role: "member", mutedUntil: null, readOnly: false } as const;
  const muted = { ...member, mutedUntil: Date.now() + 60_000 };
  const readOnly = { ...member, readOnly: true };
  const wall = { state: "visible", wall: { accountId: "a1" } } as const;
  const inCommunity = { state: "visible" } as const;

  it("lets a member reply to a visible post", () => {
    expect(mayReplyTo(inCommunity, member)).toBe(true);
    expect(postStanding(inCommunity, { ok: true, data: member })).toEqual({
      moderates: false,
      mayReply: true,
      notice: null,
    });
  });

  it("stops a muted member, and says why", () => {
    expect(mayReplyTo(inCommunity, muted)).toBe(false);
    expect(postStanding(inCommunity, { ok: true, data: muted })).toEqual({
      moderates: false,
      mayReply: false,
      notice: strings.community_muted,
    });
  });

  it("stops a member of a read-only community, and says why", () => {
    expect(mayReplyTo(inCommunity, readOnly)).toBe(false);
    expect(postStanding(inCommunity, { ok: true, data: readOnly })).toEqual({
      moderates: false,
      mayReply: false,
      notice: strings.community_read_only,
    });
  });

  it("holds a moderator to the same rule, who still moderates", () => {
    const moderator = { ...readOnly, role: "moderator" } as const;
    expect(postStanding(inCommunity, { ok: true, data: moderator })).toEqual({
      moderates: true,
      mayReply: false,
      notice: strings.community_read_only,
    });
  });

  it("stops someone who has not joined, with no sentence for a member", () => {
    const stranger = { role: null, mutedUntil: null, readOnly: false };
    expect(postStanding(inCommunity, { ok: true, data: stranger })).toEqual({
      moderates: false,
      mayReply: false,
      notice: null,
    });
  });

  it("asks a wall post no community, whatever is passed", () => {
    expect(mayReplyTo(wall)).toBe(true);
    expect(mayReplyTo(wall, muted)).toBe(true);
    expect(postStanding(wall, { ok: true, data: null })).toEqual({
      moderates: false,
      mayReply: true,
      notice: null,
    });
  });

  it("takes no reply on a post that is not visible, on a wall either", () => {
    for (const state of ["pending", "hidden", "removed"] as const) {
      expect(mayReplyTo({ state }, member)).toBe(false);
      expect(mayReplyTo({ ...wall, state })).toBe(false);
    }
  });

  it("offers no box until the community has answered", () => {
    expect(postStanding(inCommunity, null).mayReply).toBe(false);
    expect(postStanding(wall, null).mayReply).toBe(false);
  });

  it("leaves it to the server when the community is not known", () => {
    expect(mayReplyTo(inCommunity)).toBe(true);
    const failed = { ok: false, status: 500, problem: { kind: "unreachable" } } as const;
    expect(postStanding(inCommunity, failed)).toEqual({
      moderates: false,
      mayReply: true,
      notice: null,
    });
  });
});

describe("a post whose reader may not reply", () => {
  const likeTag = (html: string) => /<button[^>]*aria-pressed[^>]*>/.exec(html)?.[0] ?? "";

  it("offers no box to write in on a card, and keeps the way to its comments", () => {
    const html = draw(live(), undefined, false);
    expect(html).not.toContain(strings.post_write_comment);
    expect(html).toContain(strings.post_comment_action);
    expect(draw(live())).toContain(strings.post_write_comment);
  });

  it("disables the reaction", () => {
    expect(likeTag(draw(live(), undefined, false))).toContain(' disabled=""');
    expect(likeTag(draw(live()))).not.toContain(' disabled=""');
  });

  it("lets a reaction already given be taken back", () => {
    expect(likeTag(draw(live({ myEmoji: "👍" }), undefined, false))).not.toContain(' disabled=""');
  });

  it("disables the action that would focus a box on the post's page", () => {
    const action = (html: string) =>
      new RegExp(`<button[^>]*>(?:(?!</button>).)*${strings.post_comment_action}`).exec(html)?.[0];
    expect(action(draw(live(), undefined, false, false))).toContain(' disabled=""');
    expect(action(draw(live(), undefined, true, false))).not.toContain(' disabled=""');
  });
});

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
