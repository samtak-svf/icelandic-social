import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import {
  accountOf,
  cardMenu,
  layoutWidth,
  pageOverflow,
  person,
  post,
  write,
} from "./social-helpers.ts";
import { expect, test, WEB } from "./origin.ts";

// The wall (decision 0115) through what a person sees: one's own wall, a
// friend's, a stranger's, the audience of a post, a block, and the owner
// taking a comment away.

const button = (name: string) => ({ name, exact: true });

/** `a` asks `b` to be friends and `b` accepts, each on the other's screen. */
async function befriend(a: Page, b: Page) {
  await a.goto(`${WEB}/people/${await accountOf(b)}`);
  await a.getByRole("button", button(strings.person_add_friend)).click();
  await expect(a.getByText(strings.person_request_sent, { exact: true })).toBeVisible();
  await b.goto(`${WEB}/people/${await accountOf(a)}`);
  await b.getByRole("button", button(strings.person_accept)).click();
  await expect(b.getByText(strings.person_friends, { exact: true })).toBeVisible();
}

/** Writes on one's own wall, `everyone` choosing the wider audience; friends is the default. */
async function writeOnWall(page: Page, text: string, everyone = false) {
  await page.goto(`${WEB}/`);
  await page.getByRole("button", { name: strings.post_compose_prompt }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", button(strings.wall_audience_friends))).toBeChecked();
  await expect(dialog.getByText(strings.wall_not_encrypted_notice, { exact: true })).toBeVisible();
  if (everyone) await dialog.getByRole("radio", button(strings.wall_audience_everyone)).check();
  await write(page, strings.post_compose, strings.post_publish, text);
}

test("the owner's wall: tabs, a post for friends, a bio, and the audience changed afterwards", async ({
  browser,
}) => {
  test.slow();
  const a = await person(browser, "Auður Prófsdóttir");
  await a.goto(`${WEB}/`);
  await expect(a.getByRole("heading", { level: 1 })).toContainText("Auður Prófsdóttir");
  for (const tab of [strings.wall_tab_posts, strings.wall_tab_about, strings.wall_tab_images]) {
    await expect(a.getByRole("button", button(tab))).toBeVisible();
  }
  await expect(a.getByText(strings.posts_empty, { exact: true })).toBeVisible();

  await writeOnWall(a, "Fyrsta innlegg á vegginn");
  const card = post(a, "Fyrsta innlegg á vegginn");
  await expect(card).toBeVisible();
  await expect(card.locator('[data-audience="friends"]')).toContainText(
    strings.wall_audience_friends,
  );
  // A wall post carries no community byline and no link to a community.
  await expect(card.locator('a[href^="/communities/"]')).toHaveCount(0);

  await a.getByRole("button", button(strings.wall_bio_label)).click();
  await a.getByLabel(strings.wall_bio_label).fill("Ég skrifa um allt");
  await a.getByRole("button", button(strings.save)).click();
  await expect(a.getByText("Ég skrifa um allt", { exact: true })).toBeVisible();
  await a.reload();
  await expect(a.getByText("Ég skrifa um allt", { exact: true })).toBeVisible();

  await a.getByRole("button", button(strings.wall_bio_label)).click();
  await a.getByLabel(strings.wall_bio_label).fill("x".repeat(121));
  await expect(a.getByText(strings.wall_bio_too_long, { exact: true })).toBeVisible();
  await expect(a.getByRole("button", button(strings.save))).toBeDisabled();
  await a.getByRole("button", button(strings.cancel)).click();

  await cardMenu(post(a, "Fyrsta innlegg á vegginn"), strings.wall_audience_label);
  await a.getByRole("dialog").getByRole("radio", button(strings.wall_audience_everyone)).check();
  await a.getByRole("dialog").getByRole("button", button(strings.save)).click();
  await expect(
    post(a, "Fyrsta innlegg á vegginn").locator('[data-audience="everyone"]'),
  ).toContainText(strings.wall_audience_everyone);

  await a.getByRole("button", button(strings.wall_tab_about)).click();
  await expect(a).toHaveURL(/tab=about/);
  await a.getByRole("button", button(strings.wall_tab_images)).click();
  await expect(a.getByText(strings.community_images_empty, { exact: true })).toBeVisible();
});

test("a friend reads a friends-only post a stranger does not, and the stranger sees an empty wall", async ({
  browser,
}) => {
  test.slow();
  const a = await person(browser, "Auður Prófsdóttir");
  const b = await person(browser, "Björn Prófsson");
  const c = await person(browser, "Ásta Prófsdóttir");
  await writeOnWall(a, "Aðeins fyrir vini");
  await writeOnWall(a, "Fyrir alla innskráða", true);
  await befriend(b, a);
  const aId = await accountOf(a);

  await b.goto(`${WEB}/people/${aId}`);
  await expect(b.getByRole("heading", { level: 1 })).toContainText("Auður Prófsdóttir");
  await expect(post(b, "Aðeins fyrir vini")).toBeVisible();
  await expect(post(b, "Fyrir alla innskráða")).toBeVisible();
  // A visitor is offered neither the composer nor the owner's controls.
  await expect(b.getByRole("button", { name: strings.post_compose_prompt })).toHaveCount(0);
  await expect(b.getByRole("button", button(strings.wall_bio_label))).toHaveCount(0);

  await c.goto(`${WEB}/people/${aId}`);
  await expect(c.getByRole("heading", { level: 1 })).toContainText("Auður Prófsdóttir");
  await expect(post(c, "Fyrir alla innskráða")).toBeVisible();
  await expect(post(c, "Aðeins fyrir vini")).toHaveCount(0);
  await expect(c.getByRole("button", button(strings.person_add_friend))).toBeVisible();
});

test("a stranger who may read nothing sees the empty state, not an error", async ({ browser }) => {
  const a = await person(browser, "Auður Prófsdóttir");
  const c = await person(browser, "Ásta Prófsdóttir");
  await writeOnWall(a, "Aðeins fyrir vini");
  await c.goto(`${WEB}/people/${await accountOf(a)}`);
  await expect(c.getByRole("heading", { level: 1 })).toContainText("Auður Prófsdóttir");
  await expect(c.getByText(strings.posts_empty, { exact: true })).toBeVisible();
  await expect(c.getByText(strings.problem_not_found, { exact: true })).toHaveCount(0);
});

test("a blocked person finds no wall", async ({ browser }) => {
  const a = await person(browser, "Auður Prófsdóttir");
  const b = await person(browser, "Björn Prófsson");
  const aId = await accountOf(a);
  const bId = await accountOf(b);
  await a.goto(`${WEB}/people/${bId}`);
  a.on("dialog", (dialog) => void dialog.accept());
  await a.getByRole("button", { name: strings.notice_menu }).click();
  await a.getByRole("menuitem", { name: strings.block, exact: true }).click();
  await expect(a).toHaveURL(/\/friends$/);
  await b.goto(`${WEB}/people/${aId}`);
  await expect(b.getByText(strings.problem_not_found, { exact: true })).toBeVisible();
});

test("the owner takes a comment off the wall with a reason, and a visitor can only report it", async ({
  browser,
}) => {
  test.slow();
  const a = await person(browser, "Auður Prófsdóttir");
  const b = await person(browser, "Björn Prófsson");
  await writeOnWall(a, "Innlegg með athugasemd");
  await befriend(b, a);
  await b.goto(`${WEB}/people/${await accountOf(a)}`);
  await post(b, "Innlegg með athugasemd")
    .getByRole("link", { name: strings.post_write_comment })
    .click();
  await write(b, strings.comment_compose, strings.comment_publish, "Óboðin athugasemd");
  await expect(b.getByRole("button", button(strings.wall_comment_remove))).toHaveCount(0);

  await a.goto(`${WEB}/`);
  await post(a, "Innlegg með athugasemd")
    .getByRole("link", { name: strings.post_write_comment })
    .click();
  await expect(a.getByText("Óboðin athugasemd", { exact: true })).toBeVisible();
  await a.getByRole("button", button(strings.wall_comment_remove)).click();
  await a.getByLabel(strings.wall_comment_remove_reason).fill("Á ekki heima hér");
  await a.getByRole("dialog").getByRole("button", button(strings.wall_comment_remove)).click();
  await expect(a.getByText("Óboðin athugasemd", { exact: true })).toHaveCount(0);
  // The way back from the post leads to the wall, not to a community.
  await a.getByRole("link", { name: strings.post_back }).click();
  await expect(a).toHaveURL(`${WEB}/`);
});

test("fits a phone, with no sideways scroll", async ({ browser }) => {
  const a = await person(browser, "Auður Prófsdóttir");
  const b = await person(browser, "Björn Prófsson");
  await a.setViewportSize({ width: 360, height: 800 });
  for (const path of ["/", `/people/${await accountOf(b)}`, "/?tab=about", "/?tab=images"]) {
    await a.goto(`${WEB}${path}`);
    await expect(a.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await pageOverflow(a)).toBeLessThanOrEqual(0);
    expect(await layoutWidth(a)).toBeLessThanOrEqual(360);
  }
});
