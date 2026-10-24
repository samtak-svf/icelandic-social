import { strings } from "../src/generated/brand/strings.ts";
import { SIZE_CLASSES } from "../src/generated/frames.ts";
import { layoutOf } from "../src/ui/layout.ts";
import { expect, test } from "./origin.ts";
import { found, openMenu, person } from "./social-helpers.ts";

// Stjórna at the contract's size classes (decision 0087): on an expanded
// window a side navigation reaches each part of it, with what waits on each,
// and stays in place from page to page; below expanded Stjórna is the one
// screen of decisions 0079 and 0080.

const PARTS = [
  [strings.community_edit, /\/manage$/],
  [strings.join_requests_title, /\/requests$/],
  [strings.moderation_queue, /\/reports$/],
  [strings.community_members_title, /\/members$/],
  [strings.moderation_log_title, /\/log$/],
] as const;

test("Stjórna is a side navigation on an expanded window and one screen below it", async ({
  browser,
}) => {
  test.slow();
  const owner = await person(browser, "Eigandi Stjórnadal");
  const community = await found(owner, "private");
  const asker = await person(browser, "Spyrjandi Stjórnadal");
  await asker.goto(community);
  await asker.getByRole("button", { name: strings.community_request_join }).click();
  await expect(asker.getByText(strings.community_join_requested)).toBeVisible();
  await asker.context().close();

  await owner.reload();
  await openMenu(owner);
  await owner.getByRole("menuitem", { name: new RegExp(`^${strings.community_manage}`) }).click();
  await owner.waitForURL(/\/manage$/);
  const manage = owner.url();

  for (const width of [412, SIZE_CLASSES.medium, SIZE_CLASSES.expanded - 1]) {
    expect(layoutOf(width).manage).toBe("one-screen");
    await owner.setViewportSize({ width, height: 800 });
    await owner.goto(manage);
    const main = owner.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(main.getByRole("navigation", { name: strings.community_manage })).toBeHidden();
    await expect(
      main.getByRole("link", { name: strings.join_requests_waiting({ count: 1 }) }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", { name: strings.community_members_title }),
    ).toBeVisible();
    await expect(main.getByRole("heading", { name: strings.moderation_log_title })).toBeVisible();
  }

  for (const width of [SIZE_CLASSES.expanded, 1440]) {
    expect(layoutOf(width).manage).toBe("side-nav");
    await owner.setViewportSize({ width, height: 800 });
    await owner.goto(manage);
    const main = owner.getByRole("main");
    const nav = main.getByRole("navigation", { name: strings.community_manage });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveText(
      PARTS.map(([name]) => (name === strings.join_requests_title ? `${name}1` : name)),
    );
    // The parts the navigation reaches leave this page; the details are open.
    await expect(main.getByRole("heading", { name: strings.community_members_title })).toBeHidden();
    await expect(main.getByRole("heading", { name: strings.moderation_log_title })).toBeHidden();
    await expect(main.getByLabel(strings.community_name)).toBeVisible();
    await expect(main.getByRole("button", { name: strings.community_delete })).toBeVisible();
    const content = (await main.getByLabel(strings.community_name).boundingBox())!;
    const at = (await nav.boundingBox())!;
    expect(content.x).toBeGreaterThanOrEqual(at.x + at.width);
    expect(await owner.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

    // Each part is a page of its own, and the navigation stays where it was.
    for (const [name, url] of PARTS) {
      await nav.getByRole("link", { name }).click();
      await owner.waitForURL(url);
      if (name !== strings.community_edit) {
        await expect(main.getByRole("heading", { level: 1, name })).toBeVisible();
      }
      const now = (await nav.boundingBox())!;
      expect([now.x, now.y, now.width]).toEqual([at.x, at.y, at.width]);
    }
  }
});
