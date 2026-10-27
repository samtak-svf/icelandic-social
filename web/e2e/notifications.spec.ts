import { strings } from "../src/generated/brand/strings.ts";
import { found, join, person, post, write } from "./social-helpers.ts";
import { DEV, expect, test, WEB } from "./origin.ts";

// Notifications v2 on the web (decisions 0103, 0104, 0106), through what a
// person sees: two people react to one post and its author sees ONE row
// naming both; opening the list clears the badge but not the row; and a
// level set in Settings is still there after a reload.

/** Runs the jobs that are due, as the minute cron would (backend/dev/worker.ts). */
async function runJobs() {
  expect((await fetch(`${DEV}/dev/jobs`, { method: "POST" })).status).toBe(204);
}

test("two reactions are one row; seen clears the badge, a click reads the row; a level persists", async ({
  browser,
}) => {
  test.slow();
  const a = await person(browser, "Auður Prófsdóttir");
  const b = await person(browser, "Björn Prófsson");
  const c = await person(browser, "Cecilía Prófsdóttir");
  const community = await found(a, "open");
  await join(b, community);
  await join(c, community);

  await write(a, strings.post_compose, strings.post_publish, "Fundur á morgun kl. 20.");
  for (const [index, one] of [b, c].entries()) {
    await one.goto(community);
    const card = post(one, "Fundur á morgun");
    await card.getByRole("button", { name: strings.post_like, exact: true }).click();
    // Liked, the button takes the reaction's name, so the count is what shows it landed.
    await expect(card.getByText(strings.reaction_count({ count: index + 1 }))).toBeVisible();
  }
  await runJobs();

  // One row, naming both, whichever reacted last.
  await a.reload();
  const bell = a.getByRole("link", { name: new RegExp(strings.notifications_title) });
  await expect(bell).toContainText(strings.notifications_unread({ count: 1 }));
  await bell.click();
  const names = ["Björn Prófsson", "Cecilía Prófsdóttir"] as const;
  const sentence = (name: string, other: string) =>
    a.getByText(strings.notice_reaction_two({ name, other }), { exact: true });
  const both = sentence(names[0], names[1]).or(sentence(names[1], names[0]));
  await expect(both).toHaveCount(1);
  const row = a.getByRole("listitem").filter({ has: both });

  // Opening the list cleared the badge, and the row is still unread.
  await expect(bell).not.toContainText(strings.notifications_unread({ count: 1 }));
  await expect(row.locator("> div")).toHaveClass(/bg-muted/);

  // Clicking the row reads it; back on the list it is plain.
  await row.getByRole("link").click();
  await expect(a.getByText("Fundur á morgun").first()).toBeVisible();
  await bell.click();
  await expect(a.getByRole("listitem").filter({ has: both }).locator("> div")).not.toHaveClass(
    /bg-muted/,
  );

  // A level set in Settings is still set after a reload.
  await a.goto(`${WEB}/settings`);
  const level = a.getByLabel(strings.notification_kind_reaction);
  await level.selectOption("in_app");
  await expect(level).toHaveValue("in_app");
  await a.reload();
  await expect(a.getByLabel(strings.notification_kind_reaction)).toHaveValue("in_app");
});
