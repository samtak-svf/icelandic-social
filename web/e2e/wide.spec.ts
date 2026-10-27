import type { Locator, Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { SIZE_CLASSES, sizeClassOf } from "../src/generated/frames.ts";
import { layoutOf } from "../src/ui/layout.ts";
import { expect, test } from "./origin.ts";
import { found, person, post, write } from "./social-helpers.ts";

// The shell at the contract's size classes (decision 0087): a bar at the
// bottom of a compact window, a rail down the left from medium up, at each
// boundary and on either side of it. `Bjóða` ends the header row, and the
// post screen's bars are as wide as the post, at every width.

const WIDTHS = [
  412,
  SIZE_CLASSES.medium - 1,
  SIZE_CLASSES.medium,
  SIZE_CLASSES.expanded - 1,
  SIZE_CLASSES.expanded,
  1440,
];
const HEIGHT = 900;

async function box(locator: Locator) {
  const measured = await locator.boundingBox();
  expect(measured).not.toBeNull();
  return measured!;
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const width of WIDTHS) {
  test(`at ${width} px the places are a ${sizeClassOf(width) === "compact" ? "bottom bar" : "left rail"}, the bell ends the top bar, Bjóða ends the header and the post bars match the post`, async ({
    browser,
  }) => {
    const member = await person(browser, "Breiðskjár Mælisdóttir");
    await member.setViewportSize({ width, height: HEIGHT });
    const community = await found(member, "open");

    const nav = member.getByRole("navigation", { name: strings.main_navigation });
    const main = member.getByRole("main");
    const rail = await box(nav);
    const content = await box(main);
    if (sizeClassOf(width) === "compact") {
      expect(rail.width).toBe(width);
      expect(rail.y + rail.height).toBeCloseTo(HEIGHT, 0);
      expect(rail.height).toBeLessThan(100);
    } else {
      expect(rail.x).toBe(0);
      expect(rail.height).toBeCloseTo(HEIGHT, 0);
      expect(rail.width).toBeLessThan(120);
      expect(content.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    }
    // The name shows once: above the page, or at the top of the rail.
    await expect(member.locator("[data-app-name]").filter({ visible: true })).toHaveCount(1);
    for (const place of [strings.tab_me, strings.tab_communities, strings.settings_title]) {
      await expect(nav.getByRole("link", { name: place })).toBeInViewport();
    }
    expect(await overflow(member)).toBeLessThanOrEqual(0);

    // The notifications are no place but the bell at the right of the top bar,
    // above the page and in line with its edge (decision 0109).
    await expect(nav.getByRole("link", { name: strings.notifications_title })).toHaveCount(0);
    const bell = await box(member.getByRole("link", { name: strings.notifications_title }));
    expect(bell.y + bell.height).toBeLessThanOrEqual(content.y + 1);
    expect(bell.x + bell.width).toBeCloseTo(content.x + content.width - 16, 0);

    // Bjóða sits at the end of the row under the description.
    const header = main.locator("header").first();
    const invite = await box(header.getByRole("button", { name: strings.invite, exact: true }));
    const row = await box(header);
    expect(invite.x + invite.width).toBeCloseTo(row.x + row.width, 0);
    // Beside a feed the pictures are in the aside (wide-community.spec.ts).
    if (layoutOf(width).community === "column") {
      const stack = await box(header.getByRole("list", { name: strings.community_members_stack }));
      expect(Math.abs(invite.y + invite.height / 2 - (stack.y + stack.height / 2))).toBeLessThan(2);
    }

    // The post screen: the back bar and the comment box span the post, no wider.
    await member.goto(community);
    await write(member, strings.post_compose, strings.post_publish, "Póstur á breiðum skjá.");
    await post(member, "Póstur á breiðum skjá.")
      .getByRole("link", { name: strings.post_comment_action, exact: true })
      .click();
    const backLink = member.getByRole("link", { name: strings.post_back });
    await expect(backLink).toBeVisible();
    const card = await box(post(member, "Póstur á breiðum skjá."));
    const back = await box(backLink.locator(".."));
    const composer = await box(member.locator("[data-comment-composer]"));
    for (const bar of [back, composer]) {
      expect(bar.x).toBeCloseTo(card.x, 0);
      expect(bar.width).toBeCloseTo(card.width, 0);
    }
    expect(await overflow(member)).toBeLessThanOrEqual(0);
  });
}

// Every place's name stays on one line, on a small phone and in the rail, and
// marking a place as the current one does not change how wide its name is.
for (const width of [360, ...WIDTHS]) {
  test(`at ${width} px every place's name is one line, the current one too`, async ({
    browser,
  }) => {
    const member = await person(browser, "Einlína Merkisdóttir");
    await member.setViewportSize({ width, height: HEIGHT });
    const nav = member.getByRole("navigation", { name: strings.main_navigation });
    const lines = () =>
      nav.evaluate((element) =>
        [...element.querySelectorAll("a")].map((link) => {
          const range = document.createRange();
          range.selectNodeContents(link.querySelector("span:last-child")!);
          return [link.textContent, new Set([...range.getClientRects()].map((r) => r.top)).size];
        }),
      );
    const widths = () =>
      nav.evaluate((element) =>
        [...element.querySelectorAll("a span:last-child")].map(
          (s) => s.getBoundingClientRect().width,
        ),
      );
    const before = await widths();
    await nav.getByRole("link", { name: strings.tab_communities }).click();
    await expect(nav.getByRole("link", { name: strings.tab_communities })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const [name, count] of await lines()) expect(count, `${name}`).toBe(1);
    expect(await widths()).toEqual(before);
  });
}
