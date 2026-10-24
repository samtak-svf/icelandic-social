import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { png } from "./images.ts";
import { expect, test } from "./origin.ts";
import { cardMenu, found, join, openComposer, person, post, write } from "./social-helpers.ts";

// A community's tabs (decision 0089): Umræða, Fest, Myndir, Meðlimir and Um
// are routes of their own, in a sticky row that scrolls sideways on a compact
// window, and a non-member of a private community has only Um.

const WIDTHS = [412, 1440];

const tabs = (page: Page) => page.getByRole("navigation", { name: strings.community_tabs });
const tab = (page: Page, name: string) => tabs(page).getByRole("link", { name, exact: true });

/** Presses a tab, then expects it to be the current one at the address that ends in `suffix`. */
async function openTab(page: Page, name: string, suffix: string, root: string) {
  await tab(page, name).click();
  await expect(page).toHaveURL(`${root}${suffix}`);
  await expect(tab(page, name)).toHaveAttribute("aria-current", "page");
}

test("each tab is a route with its own content, the row sticks and back returns to the tab before", async ({
  browser,
}) => {
  test.slow();
  const owner = await person(browser, "Eigandi Flipadóttir");
  const root = await found(owner, "open", "Við ræktum grænmeti saman.");
  const member = await person(browser, "Meðlimur Flipason");
  await join(member, root);

  // A post with an image, and one the owner then features.
  await openComposer(member);
  await member
    .getByRole("dialog")
    .getByLabel(strings.post_add_images)
    .setInputFiles({ name: "mynd.png", mimeType: "image/png", buffer: await png(member) });
  await write(member, strings.post_compose, strings.post_publish, "Mynd úr garðinum.");
  await write(owner, strings.post_compose, strings.post_publish, "Fundur á laugardag.");
  await owner.reload();

  // No post is featured: there is no Fest.
  await expect(tab(owner, strings.community_tab_featured)).toHaveCount(0);
  await cardMenu(post(owner, "Fundur á laugardag"), strings.post_pin);
  await expect(tab(owner, strings.community_tab_featured)).toBeVisible();

  for (const width of WIDTHS) {
    await owner.setViewportSize({ width, height: 700 });
    await owner.goto(root);
    await expect(tab(owner, strings.community_tab_discussion)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(post(owner, "Mynd úr garðinum")).toBeVisible();
    // The row is a plain nav of links, not a tablist.
    await expect(owner.getByRole("tablist")).toHaveCount(0);

    // Fest: the featured post as a full card.
    await openTab(owner, strings.community_tab_featured, "/featured", root);
    await expect(post(owner, "Fundur á laugardag")).toBeVisible();
    await expect(post(owner, "Mynd úr garðinum")).toHaveCount(0);

    // Myndir: a grid whose tap opens the post.
    await openTab(owner, strings.community_tab_images, "/images", root);
    const grid = owner.getByRole("main").getByRole("link", { name: strings.post_title });
    await expect(grid).toHaveCount(1);
    await expect
      .poll(() =>
        grid.getByRole("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
      )
      .toBeGreaterThan(0);

    // Meðlimir: the owner first, then the member.
    await openTab(owner, strings.community_tab_members, "/people", root);
    const names = owner.getByRole("main").getByText(/Flipa(dóttir|son)/);
    await expect(names.first()).toContainText("Eigandi Flipadóttir");
    await expect(names.last()).toContainText("Meðlimur Flipason");

    // Um: the community's description.
    await openTab(owner, strings.community_tab_about, "/about", root);
    await expect(owner.getByText("Við ræktum grænmeti saman.").last()).toBeVisible();

    // Back returns to the tab before, one at a time.
    for (const [name, suffix] of [
      [strings.community_tab_members, "/people"],
      [strings.community_tab_images, "/images"],
      [strings.community_tab_featured, "/featured"],
    ] as const) {
      await owner.goBack();
      await expect(owner).toHaveURL(`${root}${suffix}`);
      await expect(tab(owner, name)).toHaveAttribute("aria-current", "page");
    }

    // The tap on an image opens its post, and back returns to Myndir.
    await openTab(owner, strings.community_tab_images, "/images", root);
    await owner.getByRole("main").getByRole("link", { name: strings.post_title }).click();
    await expect(owner).toHaveURL(/\/posts\//);
    await owner.goBack();
    await expect(owner).toHaveURL(`${root}/images`);

    // The row is sticky: after scrolling it is still at the top of the window.
    await owner.goto(root);
    for (let i = 0; i < 6; i++) {
      await write(owner, strings.post_compose, strings.post_publish, `Fylling ${width}-${i}.`);
    }
    await owner.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(() => tabs(owner).evaluate((nav) => Math.round(nav.getBoundingClientRect().top)))
      .toBeLessThan(80);
    await expect(tabs(owner)).toBeInViewport();

    // On compact the row scrolls sideways, and the page itself does not.
    const overflow = await tabs(owner).evaluate((nav) => ({
      row: nav.scrollWidth > nav.clientWidth,
      page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    expect(overflow.page).toBe(false);
    if (width < 600) expect(overflow.row).toBe(true);
  }
});

test("the search is an icon at the end of the row, and opens the field on Umræða", async ({
  browser,
}) => {
  const owner = await person(browser, "Eigandi Leitardóttir");
  const root = await found(owner, "open");
  await write(owner, strings.post_compose, strings.post_publish, "Kartöflur í ágúst.");
  await write(owner, strings.post_compose, strings.post_publish, "Rófur í september.");

  // No full-width field above the feed until the icon is pressed.
  const field = owner.getByLabel(strings.community_search_posts, { exact: true });
  await expect(field).toHaveCount(0);
  const icon = tabs(owner).getByRole("button", { name: strings.community_search_posts });
  await icon.click();
  await expect(icon).toHaveAttribute("aria-pressed", "true");
  await field.fill("Kartöflur");
  await expect(post(owner, "Kartöflur í ágúst")).toBeVisible();
  await expect(post(owner, "Rófur í september")).toHaveCount(0);

  // Closing it brings every post back.
  await icon.click();
  await expect(field).toHaveCount(0);
  await expect(post(owner, "Rófur í september")).toBeVisible();
  await expect(owner).toHaveURL(root);
});

test("a non-member of a private community sees only the header and Um", async ({ browser }) => {
  const owner = await person(browser, "Eigandi Lokadóttir");
  const root = await found(owner, "private", "Lokaður hópur.");
  await write(owner, strings.post_compose, strings.post_publish, "Aðeins fyrir félaga.");
  const stranger = await person(browser, "Gestur Utanaðkomandi");
  await stranger.goto(root);

  await expect(tabs(stranger).getByRole("link")).toHaveCount(1);
  await expect(tab(stranger, strings.community_tab_about)).toBeVisible();
  await expect(tabs(stranger).getByRole("button")).toHaveCount(0);
  await expect(post(stranger, "Aðeins fyrir félaga")).toHaveCount(0);

  // The other tabs' addresses show nothing either.
  for (const suffix of ["/images", "/people", "/featured"]) {
    await stranger.goto(`${root}${suffix}`);
    await expect(post(stranger, "Aðeins fyrir félaga")).toHaveCount(0);
    await expect(stranger.getByRole("main").getByRole("img")).toHaveCount(0);
    await expect(stranger.getByRole("main").getByText(/Lokadóttir/)).toHaveCount(0);
  }
});
