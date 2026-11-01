import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { AuthorName, lastWord } from "./author-name.tsx";
import { PostMarks, PostView } from "./post.tsx";
import { isPostTombstone } from "./post-tombstone.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

// A wrapped name must keep the mark after its last word, not on a line of its own or at the
// far edge of the row (2026-10-26, on a phone). The browser layout is e2e/post-layout.spec.ts;
// this holds the markup that makes it.
const author = (verified: boolean, name = "Höfundur Langt Nafn") => ({
  accountId: "a1",
  name,
  verified,
  photo: null,
  role: null,
});

describe("lastWord", () => {
  it("splits before the last word", () => {
    expect(lastWord("Höfundur Langt Nafn")).toEqual(["Höfundur Langt ", "Nafn"]);
  });

  it("leaves a one-word name whole", () => {
    expect(lastWord("Nafn")).toEqual(["", "Nafn"]);
  });
});

describe("AuthorName", () => {
  it("holds the mark to the name's last word in one unbreakable span", () => {
    const html = renderToStaticMarkup(<AuthorName author={author(true)} />);
    expect(html).toMatch(/^<span[^>]*>Höfundur Langt <span class="whitespace-nowrap">Nafn<span/);
    expect(html).toContain(strings.verified_short);
  });

  it("shows only the name when the account is not verified", () => {
    const html = renderToStaticMarkup(<AuthorName author={author(false)} />);
    expect(html).not.toContain("whitespace-nowrap");
    expect(html).not.toContain(strings.verified_short);
  });
});

const tombstone = (over: Partial<Post> = {}): Post => ({
  postId: "p1",
  communityId: "c1",
  author: null,
  anonymous: false,
  mine: false,
  body: "",
  media: [],
  createdAt: 1_700_000_000_000,
  reactions: [],
  myReaction: null,
  emojis: [],
  myEmoji: "",
  commentCount: 0,
  latestComment: null,
  state: "removed",
  pinned: false,
  ...over,
});

describe("a removed post's place", () => {
  const draw = (post: Post, moderates: boolean) =>
    renderToStaticMarkup(
      <PostView
        post={post}
        linked={true}
        deleted={() => undefined}
        changed={() => undefined}
        moderates={moderates}
        mayReply={true}
      />,
    );

  it("is what a reader gets, and nothing a moderator's copy would match", () => {
    expect(isPostTombstone(tombstone())).toBe(true);
    expect(isPostTombstone(tombstone({ body: "Textinn" }))).toBe(false);
    expect(isPostTombstone(tombstone({ author: author(false) }))).toBe(false);
    expect(isPostTombstone(tombstone({ anonymous: true }))).toBe(false);
    expect(isPostTombstone(tombstone({ state: "hidden" }))).toBe(false);
  });

  it("marks a post that was imported, and only that one", () => {
    const mark = (over: Partial<Post>) =>
      renderToStaticMarkup(<PostMarks post={tombstone(over)} />);
    expect(mark({ imported: true })).toContain(strings.post_imported);
    expect(mark({ imported: false })).not.toContain(strings.post_imported);
    expect(mark({})).not.toContain(strings.post_imported);
  });

  it("tells a member only that it was removed", () => {
    const html = draw(tombstone(), false);
    expect(html).toContain(strings.content_removed);
    expect(html).not.toContain("<a ");
  });

  it("leads its author to the reasons", () => {
    const html = draw(tombstone({ mine: true }), false);
    expect(html).toContain('href="/statements"');
    expect(html).toContain(strings.statement_open);
  });

  it("leads a moderator to the post", () => {
    const html = draw(tombstone(), true);
    expect(html).toContain('href="/posts/$postId"');
    expect(html).not.toContain('href="/statements"');
  });
});
