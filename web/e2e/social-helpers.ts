import type { Browser, Locator, Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { expect, serveOrigin } from "./origin.ts";
import { signInVerified } from "./accounts.ts";

// What the social specs share: people in browsers of their own, the composer,
// a post card's menu and the founding of a community.

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
  await page.getByLabel(label).fill(text);
  await page.getByRole("button", { name: action }).click();
  await expect(page.getByLabel(label)).toHaveValue("");
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
export async function found(owner: Page, audience: "open" | "private"): Promise<string> {
  const name = `Garðyrkjufélagið ${crypto.randomUUID().slice(0, 8)}`;
  await owner.getByRole("link", { name: strings.tab_communities }).click();
  await owner.getByRole("link", { name: new RegExp(`^${strings.community_create}`) }).click();
  await owner.getByLabel(strings.community_name).fill(name);
  if (audience === "private") {
    await owner.getByRole("radio", { name: new RegExp(strings.community_private_hint) }).check();
  }
  await owner.getByRole("button", { name: strings.community_create }).click();
  await expect(owner.getByRole("heading", { name })).toBeVisible();
  return owner.url();
}

/** Opens the community's `⋯` menu (decision 0080) and leaves it open. */
export async function openMenu(page: Page) {
  // The bar comes first in the page, before any card.
  await page.getByRole("button", { name: strings.more_options }).first().click();
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
