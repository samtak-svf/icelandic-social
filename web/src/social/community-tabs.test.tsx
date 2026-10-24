import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import { CommunityTabs, tabOf, tabsFor } from "./community-tabs.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to,
    ...rest
  }: {
    children: ReactNode;
    className?: string;
    to: string;
    "aria-current"?: "page";
  }) => (
    <a className={className} href={to} aria-current={rest["aria-current"]}>
      {children}
    </a>
  ),
}));

// Under Node there is no router; `Link` is stubbed so the server render shows
// the row. Navigation and stickiness are e2e/community-tabs.spec.ts.
const row = (props: Partial<Parameters<typeof CommunityTabs>[0]> = {}) =>
  renderToStaticMarkup(
    <CommunityTabs
      communityId="cm1"
      active="discussion"
      readable
      hasFeatured
      searching={false}
      onSearch={() => {}}
      {...props}
    />,
  );

describe("the tab of a path", () => {
  it("maps the last segment, and the community's root is Umræða", () => {
    expect(tabOf("/communities/cm1")).toBe("discussion");
    expect(tabOf("/communities/cm1/")).toBe("discussion");
    expect(tabOf("/communities/cm1/featured")).toBe("featured");
    expect(tabOf("/communities/cm1/images")).toBe("images");
    expect(tabOf("/communities/cm1/people")).toBe("members");
    expect(tabOf("/communities/cm1/about")).toBe("about");
  });
});

describe("the tabs a reader gets", () => {
  it("hides Fest while nothing is featured", () => {
    expect(tabsFor(true, false)).toEqual(["discussion", "images", "members", "about"]);
    expect(tabsFor(true, true)).toContain("featured");
  });

  it("gives a reader who may not read only Um", () => {
    expect(tabsFor(false, true)).toEqual(["about"]);
  });
});

describe("the row of tabs", () => {
  it("is a nav of links, not a tablist, with the active one marked current", () => {
    const html = row({ active: "images" });
    expect(html).toContain(`<nav aria-label="${strings.community_tabs}"`);
    expect(html).not.toContain("tablist");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*>${strings.community_tab_images}<`));
  });

  it("sticks, and scrolls sideways until a medium window", () => {
    const html = row();
    expect(html).toContain("sticky top-0");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("medium:overflow-visible");
  });

  it("leaves Fest out while empty and puts it in when featured", () => {
    expect(row({ hasFeatured: false })).not.toContain(strings.community_tab_featured);
    expect(row()).toContain(strings.community_tab_featured);
  });

  it("shows a private community's non-member only Um and no search", () => {
    const html = row({ readable: false, active: "about" });
    expect(html).toContain(strings.community_tab_about);
    for (const hidden of [
      strings.community_tab_discussion,
      strings.community_tab_images,
      strings.community_tab_members,
      strings.community_search_posts,
    ]) {
      expect(html).not.toContain(hidden);
    }
  });

  it("ends in a search button that says whether the field is open", () => {
    expect(row()).toContain(`aria-label="${strings.community_search_posts}" aria-pressed="false"`);
    expect(row({ searching: true })).toContain('aria-pressed="true"');
  });
});
