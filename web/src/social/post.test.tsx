import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import { AuthorName, WORD_JOINER } from "./post.tsx";

vi.mock("@tanstack/react-router", () => ({ Link: () => null }));

// A wrapped name must keep the mark after its last word, not at the far edge of the row
// (2026-10-26, on a phone). The browser layout is e2e/; this holds the markup that makes it.
const author = (verified: boolean) => ({
  accountId: "a1",
  name: "Höfundur Langt Nafn",
  verified,
  photo: null,
  role: null,
});

describe("AuthorName", () => {
  it("holds the mark to the name's last word inside one span", () => {
    const html = renderToStaticMarkup(<AuthorName author={author(true)} />);
    expect(html).toMatch(new RegExp(`^<span[^>]*>Höfundur Langt Nafn${WORD_JOINER}<span`));
    expect(html).toContain(strings.verified_short);
    expect(html).not.toContain("inline-flex min-w-0 flex-nowrap");
  });

  it("shows only the name when the account is not verified", () => {
    const html = renderToStaticMarkup(<AuthorName author={author(false)} />);
    expect(html).not.toContain(WORD_JOINER);
    expect(html).not.toContain(strings.verified_short);
  });
});
