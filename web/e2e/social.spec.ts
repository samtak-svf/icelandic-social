import type { Browser, Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { expect, serveOrigin, test, WEB } from "./origin.ts";
import { newKennitala } from "./people.ts";

// The first social slice on the web (#291), through what a person sees: a
// member finds and joins a community, posts, comments, reacts, is told of a
// comment and reports a post; the owner, the community's moderator, reviews
// the report and hides the post, and its author is told.

/** Where `cf dev` listens, for its dev-only paths. */
const DEV = process.env.SPJALL_DEV_URL ?? "http://127.0.0.1:8787";

/** A person in a browser of their own, signed in with Kenni as `name`. */
async function person(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await serveOrigin(page);
  await page.goto(`${WEB}/`);
  await page.getByRole("link", { name: strings.sign_in_kenni }).click();
  await page.locator('input[name="login_hint"]').fill(newKennitala());
  await page.locator('input[name="x_name"]').fill(name);
  await page.getByRole("button").click();
  await page.waitForURL(`${WEB}/`);
  await expect(page.getByText(name)).toBeVisible();
  return page;
}

/** Runs the jobs that are due, as the minute cron would (backend/dev/worker.ts). */
async function runJobs() {
  expect((await fetch(`${DEV}/dev/jobs`, { method: "POST" })).status).toBe(204);
}

async function write(page: Page, label: string, action: string, text: string) {
  await page.getByLabel(label).fill(text);
  await page.getByRole("button", { name: action }).click();
  await expect(page.getByLabel(label)).toHaveValue("");
}

const post = (page: Page, text: string) => page.getByRole("article").filter({ hasText: text });

test("a member joins, posts, comments, reacts, is told and reports; a moderator acts", async ({
  browser,
}) => {
  const owner = await person(browser, "Eigandi Prófsdóttir");
  const member = await person(browser, "Meðlimur Prófsson");
  const spammer = await person(browser, "Ruslari Prófsson");
  const name = `Garðyrkjufélagið ${crypto.randomUUID().slice(0, 8)}`;

  // The owner creates an open community.
  await owner.getByRole("link", { name: strings.tab_communities }).click();
  await owner.getByLabel(strings.community_name).fill(name);
  await owner.getByLabel(strings.community_description).fill("Allt um garða.");
  await owner.getByRole("button", { name: strings.community_create }).click();
  await expect(owner.getByRole("heading", { name })).toBeVisible();
  const community = owner.url();

  // The member finds it by name and joins.
  for (const one of [member, spammer]) {
    await one.getByRole("link", { name: strings.tab_communities }).click();
    await one.getByRole("searchbox").fill(name.slice(0, 18));
    await one.getByRole("button", { name: strings.communities_find }).click();
    await one.getByRole("link", { name: new RegExp(name) }).click();
    await one.getByRole("button", { name: strings.community_join }).click();
    await expect(one.getByRole("button", { name: strings.community_leave })).toBeVisible();
  }

  // The member posts and reacts to their own post.
  await write(member, strings.post_compose, strings.post_publish, "Tómatarnir eru komnir upp.");
  const mine = post(member, "Tómatarnir");
  const like = mine.getByRole("button", { name: strings.reaction_like });
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await expect(like).toContainText("1");

  // The owner comments on it.
  await owner.goto(community);
  await post(owner, "Tómatarnir")
    .getByRole("link", { name: strings.post_comments({ count: 0 }) })
    .click();
  await write(owner, strings.comment_compose, strings.comment_publish, "Glæsilegt!");
  await expect(owner.getByText("Glæsilegt!")).toBeVisible();

  // The member is told, opens the post from the notification and replies.
  await runJobs();
  await member.reload();
  const tab = member.getByRole("link", { name: new RegExp(strings.tab_notifications) });
  await expect(tab).toContainText(strings.notifications_unread({ count: 1 }));
  await tab.click();
  const notice = strings.notice_comment({ name: "Eigandi Prófsdóttir" });
  await member.getByRole("link", { name: new RegExp(notice) }).click();
  await expect(member.getByText("Glæsilegt!")).toBeVisible();
  await write(member, strings.comment_compose, strings.comment_publish, "Takk fyrir!");
  await expect(member.getByText("Takk fyrir!")).toBeVisible();
  await expect(tab).not.toContainText(strings.notifications_unread({ count: 1 }));

  // Someone else posts spam, and the member reports it.
  await spammer.reload();
  await write(spammer, strings.post_compose, strings.post_publish, "Ódýr úr, smelltu hér.");
  await member.goto(community);
  const spam = post(member, "Ódýr úr");
  await spam.getByRole("button", { name: strings.report }).click();
  await spam.getByLabel(strings.report_reason_spam).check();
  await spam.getByRole("button", { name: strings.report_send }).click();
  await expect(spam.getByText(strings.report_sent)).toBeVisible();

  // The owner reviews the report and hides the post.
  await owner.goto(community);
  await owner.getByRole("link", { name: strings.moderation_queue }).click();
  const report = owner.getByRole("article", { name: strings.report_reason_spam });
  await expect(report).toContainText("Ódýr úr");
  await report.getByLabel(strings.report_reason).fill("Ruslpóstur");
  await report.getByRole("button", { name: strings.moderation_hide }).click();
  await expect(owner.getByText(strings.moderation_queue_empty)).toBeVisible();

  // The member no longer sees it, and its author is told.
  await member.reload();
  await expect(post(member, "Tómatarnir")).toBeVisible();
  await expect(post(member, "Ódýr úr")).toHaveCount(0);
  await runJobs();
  await spammer.getByRole("link", { name: new RegExp(strings.tab_notifications) }).click();
  await expect(spammer.getByText(strings.notice_moderated)).toBeVisible();
});
