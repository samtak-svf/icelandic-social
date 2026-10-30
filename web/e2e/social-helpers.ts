import type { Browser, Locator, Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { layoutOf } from "../src/ui/layout.ts";
import { CLIENT, DEV, expect, serveOrigin } from "./origin.ts";
import { signInVerified } from "./accounts.ts";

// What the social specs share: people in browsers of their own, the composer,
// a post card's menu and the founding of a community.

/**
 * The page's layout width: the `html` box, which leaves out the gutter `html`
 * reserves. That gutter is 15 px with classic scrollbars, as on Linux, and nothing
 * with overlay ones, as on macOS. `innerWidth` and `clientWidth` both include it
 * while no scrollbar shows, so either would measure the platform.
 */
export function layoutWidth(page: Page) {
  return page.evaluate(() => document.documentElement.getBoundingClientRect().width);
}

/** How far the page runs past its layout width. */
export function pageOverflow(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth - document.documentElement.getBoundingClientRect().width,
  );
}

/** A person in a browser of their own, signed in with Google and marked by Kenni as `name`. */
export async function person(
  browser: Browser,
  name: string,
  permissions: string[] = [],
): Promise<Page> {
  const page = await (await browser.newContext({ permissions })).newPage();
  await serveOrigin(page);
  await signInVerified(page, name);
  return page;
}

/** Writes a post in the composer's dialog (opened from its pill), or a comment in the box. */
export async function write(page: Page, label: string, action: string, text: string) {
  if (label === strings.post_compose) {
    await openComposer(page);
    await page.getByRole("dialog").getByLabel(label).fill(text);
    await page.getByRole("dialog").getByRole("button", { name: action }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return;
  }
  // The comment box is one row: its placeholder names it, and the send icon carries the action.
  const box = page.getByPlaceholder(strings.post_write_comment);
  await box.fill(text);
  await page.getByRole("button", { name: action, exact: true }).click();
  await expect(box).toHaveValue("");
}

/** Opens the post composer's dialog from the one-row composer, unless it is open. */
export async function openComposer(page: Page) {
  if ((await page.getByRole("dialog").count()) === 0) {
    await page.getByRole("button", { name: strings.post_compose_prompt }).click();
  }
}

/** Presses an item of a post card's `⋯` menu. */
export async function cardMenu(card: Locator, item: string) {
  await card.getByRole("button", { name: strings.more_options }).click();
  await card.getByRole("menuitem", { name: item }).click();
}

export const post = (page: Page, text: string) =>
  page.getByRole("article").filter({ hasText: text });

/** Creates a community as `owner`, who is left on its page; its address. */
export async function found(
  owner: Page,
  audience: "open" | "private",
  description = "",
): Promise<string> {
  const name = `Garðyrkjufélagið ${crypto.randomUUID().slice(0, 8)}`;
  await owner.getByRole("link", { name: strings.tab_communities }).click();
  await owner.getByRole("link", { name: new RegExp(`^${strings.community_create}`) }).click();
  await owner.getByLabel(strings.community_name).fill(name);
  await owner.getByLabel(strings.community_description).fill(description);
  if (audience === "private") {
    await owner.getByRole("radio", { name: new RegExp(strings.community_private_hint) }).check();
  }
  await owner.getByRole("button", { name: strings.community_create }).click();
  // The page's own title is the h1: on an expanded window the create page's
  // preview already shows the name, as an h2.
  await expect(owner.getByRole("heading", { level: 1, name })).toBeVisible();
  return owner.url();
}

/** Whether the hub shows the reader's communities in a column beside the feed (0087). */
const hubColumn = (page: Page) => layoutOf(page.viewportSize()!.width).hub === "column";

/** The hub's list of the reader's communities: a tab, or the column beside the feed (0087). */
export function myCommunities(page: Page): Locator {
  return hubColumn(page)
    ? page.getByRole("complementary", { name: strings.communities_mine })
    : page.locator('section[aria-labelledby="mine"]');
}

/** Shows the hub's feed of what is new: a tab, or what the hub shows first beside the column. */
export async function openHubFeed(page: Page) {
  if (!hubColumn(page)) {
    await page.getByRole("button", { name: strings.communities_tab_feed }).click();
  }
}

/** Opens the community's `⋯` menu (decision 0080) and leaves it open. */
export async function openMenu(page: Page) {
  // The bar comes first in the page, before any card.
  await page.getByRole("button", { name: strings.more_options }).first().click();
}

/** Opens Stjórna from the community's `⋯` menu. */
export async function manage(page: Page) {
  await openMenu(page);
  await page.getByRole("menuitem", { name: new RegExp(`^${strings.community_manage}`) }).click();
}

/** Opens Stjórna with Breyta samfélagi unfolded. */
export async function manageDetails(page: Page) {
  await manage(page);
  // Beside the side navigation of an expanded window the details start open (decision 0087).
  if (layoutOf(page.viewportSize()!.width).manage === "one-screen") {
    await page.locator("summary", { hasText: strings.community_edit }).click();
  }
}

/** Expects the person in `page` to be a member who may leave, which the menu offers. */
export async function expectMember(page: Page) {
  await openMenu(page);
  await expect(page.getByRole("menuitem", { name: strings.community_leave })).toBeVisible();
  await page.keyboard.press("Escape");
}

/** Joins the open community at `address` as `page`. */
export async function join(page: Page, address: string) {
  await page.goto(address);
  await page.getByRole("button", { name: strings.community_join }).click();
  await expectMember(page);
}

/** The name of the community `owner` just created, read off its page. */
export async function titleOf(page: Page): Promise<string> {
  return (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
}

/** Makes the person in `page` a platform moderator, through the dev Worker. */
export async function platformModerator(page: Page) {
  const accountId = await page.evaluate(async (headers) => {
    const answer = await fetch("/v1/me", { headers });
    const body: unknown = await answer.json();
    return typeof body === "object" && body !== null && "accountId" in body
      ? String(body.accountId)
      : "";
  }, CLIENT);
  expect(accountId).not.toBe("");
  const url = `${DEV}/dev/platform-moderator?account=${encodeURIComponent(accountId)}`;
  expect((await fetch(url, { method: "POST" })).status).toBe(204);
}

/** Runs the jobs that are due, as the minute cron would (backend/dev/worker.ts). */
export async function runJobs() {
  expect((await fetch(`${DEV}/dev/jobs`, { method: "POST" })).status).toBe(204);
}
