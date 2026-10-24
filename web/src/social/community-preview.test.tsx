import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import { CommunityPreview, draftCommunity } from "./community-preview.tsx";

// The browser behaviour (the pictures, the sticky column) is e2e/wide-hub;
// under Node this holds what the server render shows.
describe("CommunityPreview", () => {
  const draft = { name: "  Garðyrkjan  ", description: "Við ræktum.", audience: "open" } as const;
  const none = { photo: null, cover: null };

  it("is hidden below expanded and drawn from it, labelled for a screen reader", () => {
    const html = renderToStaticMarkup(<CommunityPreview draft={draft} images={none} />);
    expect(html).toContain(`aria-label="${strings.community_preview}"`);
    expect(html).toMatch(/class="hidden [^"]*expanded:block/);
  });

  it("shows the typed name as a heading below the page's own, and the description in place", () => {
    const html = renderToStaticMarkup(<CommunityPreview draft={draft} images={none} />);
    expect(html).toContain(">Garðyrkjan</h2>");
    expect(html).not.toContain("<h1");
    expect(html).toContain("Við ræktum.");
    expect(html).not.toContain("expanded:hidden");
  });

  it("offers no link and no invitation, since the community does not exist yet", () => {
    const html = renderToStaticMarkup(<CommunityPreview draft={draft} images={none} />);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<button");
  });

  it("shows a chosen picture and cover from where they are held", () => {
    const html = renderToStaticMarkup(
      <CommunityPreview draft={draft} images={{ photo: "blob:p", cover: "blob:c" }} />,
    );
    expect(html).toContain('src="blob:p"');
    expect(html).toContain('src="blob:c"');
  });

  it("takes the audience from the form", () => {
    const closed = renderToStaticMarkup(
      <CommunityPreview draft={{ ...draft, audience: "private" }} images={none} />,
    );
    expect(closed).toContain(strings.community_private_full);
    expect(draftCommunity(draft).name).toBe("Garðyrkjan");
  });
});
