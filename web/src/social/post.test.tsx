import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import { AuthorName, lastWord } from "./post.tsx";

vi.mock("@tanstack/react-router", () => ({ Link: () => null }));

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
