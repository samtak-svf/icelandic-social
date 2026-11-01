import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me, Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { AudienceChoice, AudienceMark, WallAudienceFields } from "./audience.tsx";
import { PostComposer } from "./composer.tsx";
import { PostView } from "./post.tsx";
import { BioLine, CoverControls } from "./wall-edit.tsx";
import { bioTooLong, cleanBio } from "./wall-bio.ts";
import { formatIsMonth } from "../lib/is-format.ts";
import { validateWallSearch } from "./wall-tabs.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => () => undefined,
}));

const me = (suspension: Me["suspension"]): Me => ({
  accountId: "a1",
  name: "Sigrún",
  verified: false,
  photo: null,
  suspension,
  platformModerator: false,
  devices: [],
});

// The signed-in account the components read; each test sets it.
const current = vi.hoisted(() => ({ me: null as Me | null }));
vi.mock("../account.tsx", () => ({
  useAccount: () => ({
    state: current.me === null ? { status: "signed-out" } : { status: "signed-in", me: current.me },
    refresh: () => Promise.resolve(),
  }),
  useMe: () => current.me,
}));

beforeEach(() => {
  current.me = me(null);
});

const wallPost = (over: Partial<Post> = {}): Post => ({
  postId: "p1",
  communityId: "w1",
  author: { accountId: "a1", name: "Sigrún", verified: false, photo: null, role: null },
  anonymous: false,
  mine: true,
  body: "Texti",
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
  wall: { accountId: "a1" },
  audience: "friends",
  ...over,
});

const draw = (post: Post) =>
  renderToStaticMarkup(
    <PostView
      post={post}
      linked
      deleted={() => undefined}
      changed={() => undefined}
      moderates={false}
      mayReply={true}
      community={{ communityId: "w1", name: "Veggur", photo: null }}
    />,
  );

describe("a post on a wall", () => {
  it("never shows a community byline or a link to a community", () => {
    const html = draw(wallPost());
    expect(html).not.toContain('href="/communities/$communityId"');
    expect(html).not.toContain("Veggur");
  });

  it("keeps the community link on a post that is not on a wall", () => {
    const html = draw(wallPost({ wall: undefined, audience: undefined }));
    expect(html).toContain('href="/communities/$communityId"');
  });

  it("shows who may read it, and nothing on a post with no audience", () => {
    expect(draw(wallPost())).toContain(strings.wall_audience_friends);
    expect(draw(wallPost({ audience: "everyone" }))).toContain(strings.wall_audience_everyone);
    expect(renderToStaticMarkup(<AudienceMark audience={undefined} />)).toBe("");
  });
});

describe("the audience picker", () => {
  it("offers both audiences with the chosen one checked", () => {
    const html = renderToStaticMarkup(
      <AudienceChoice value="friends" onChange={() => undefined} />,
    );
    expect(html).toContain(strings.wall_audience_label);
    expect(html).toMatch(/checked=""[^>]*value="friends"/);
    expect(html).not.toMatch(/checked=""[^>]*value="everyone"/);
  });

  it("tells the writer a wall is hosted on the server and not encrypted end to end", () => {
    const html = renderToStaticMarkup(
      <WallAudienceFields value="friends" onChange={() => undefined} />,
    );
    expect(html).toContain(strings.wall_not_encrypted_notice);
    expect(html).toContain(strings.wall_audience_label);
  });
});

describe("the bio", () => {
  it("allows 120 code points and refuses one more, counting an emoji once", () => {
    expect(bioTooLong("a".repeat(120))).toBe(false);
    expect(bioTooLong("a".repeat(121))).toBe(true);
    expect(bioTooLong("😀".repeat(120))).toBe(false);
    expect(bioTooLong("😀".repeat(121))).toBe(true);
  });

  it("has no line breaks and no outer spaces", () => {
    expect(cleanBio("  eitt\nannað\r\nþriðja ")).toBe("eitt annað þriðja");
  });
});

describe("the owner's controls under a suspension", () => {
  const bio = (suspended: boolean, owner = true) =>
    renderToStaticMarkup(
      <BioLine bio="Halló" owner={owner} suspended={suspended} changed={() => undefined} />,
    );

  it("offers writing and clearing a bio to an owner who is not suspended", () => {
    const html = bio(false);
    expect(html).toContain(strings.wall_bio_label);
    expect(html).toContain(strings.delete);
  });

  it("offers a suspended owner only to clear it", () => {
    const html = bio(true);
    expect(html).not.toContain(strings.wall_bio_label);
    expect(html).toContain(strings.delete);
  });

  it("offers a visitor the text and no controls", () => {
    const html = bio(false, false);
    expect(html).toContain("Halló");
    expect(html).not.toContain("<button");
  });

  it("offers a suspended owner only to remove the cover", () => {
    const cover = (suspended: boolean) =>
      renderToStaticMarkup(
        <CoverControls
          cover="v1"
          coverFrames={null}
          suspended={suspended}
          changed={() => undefined}
        />,
      );
    expect(cover(true)).toContain(strings.community_cover_remove);
    expect(cover(true)).not.toContain(strings.community_cover_choose);
    expect(cover(true)).not.toContain(strings.image_frames_title);
    expect(cover(false)).toContain(strings.community_cover_choose);
    expect(cover(false)).toContain(strings.image_frames_title);
  });

  it("disables the composer for a suspended account", () => {
    current.me = me({ until: null });
    const html = renderToStaticMarkup(<PostComposer wall posted={() => undefined} />);
    // Both the prompt and the add-images button are refused.
    expect(html.match(/<button[^>]*\sdisabled=""/g)).toHaveLength(2);
  });
});

describe("the wall's tab and month", () => {
  it("takes about and images from the address and ignores anything else", () => {
    expect(validateWallSearch({ tab: "about" })).toEqual({ tab: "about" });
    expect(validateWallSearch({ tab: "images" })).toEqual({ tab: "images" });
    expect(validateWallSearch({ tab: "posts" })).toEqual({});
    expect(validateWallSearch({ tab: 3 })).toEqual({});
  });

  it("writes the month of joining in words", () => {
    expect(formatIsMonth("2026-10")).toBe("október 2026");
    expect(formatIsMonth("2026-13")).toBe("2026-13");
  });
});
