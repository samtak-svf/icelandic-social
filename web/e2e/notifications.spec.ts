import { strings } from "../src/generated/brand/strings.ts";
import { found, join, person, post, runJobs, titleOf, write } from "./social-helpers.ts";
import { expect, test, WEB } from "./origin.ts";

// Notifications v2 on the web (decisions 0103, 0104, 0106), through what a
// person sees: two people react to one post and its author sees ONE row
// naming both; opening the list clears the badge but not the row; and a
// level set in Settings is still there after a reload.

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

// #349: the notifications open over the page the bell was pressed on, and
// back returns there, as the apps now do.
test("back from the bell returns to the page it was pressed on", async ({ browser }) => {
  const a = await person(browser, "Auður Prófsdóttir");
  const community = await found(a, "open");
  await a.getByRole("link", { name: new RegExp(strings.notifications_title) }).click();
  await expect(a.getByRole("heading", { name: strings.notifications_title })).toBeVisible();
  await a.goBack();
  await expect(a).toHaveURL(community);
});

// Decision 0106, the community level: the lower of the kind's level and the
// community's applies, so a community set to Slökkt tells its member nothing
// while another community, left alone, still does. The kind-level case above
// sets a level for one kind; this one sets it for one community.
test("a community set to off sends no row, another community still does, and the level persists", async ({
  browser,
}) => {
  test.slow();
  const a = await person(browser, "Auður Prófsdóttir");
  const b = await person(browser, "Björn Prófsson");
  const quiet = await found(a, "open");
  const quietName = await titleOf(a);
  await write(a, strings.post_compose, strings.post_publish, "Fundur í rólega hópnum.");
  const loud = await found(a, "open");
  const loudName = await titleOf(a);
  await write(a, strings.post_compose, strings.post_publish, "Fundur í hávaðahópnum.");
  expect(quietName).not.toBe(loudName);
  await join(b, quiet);
  await join(b, loud);

  // The level is set on the community's own tab, and is still set after a reload.
  await a.goto(`${quiet}/about`);
  const level = a
    .getByRole("main")
    .getByRole("combobox", { name: strings.notification_settings_title });
  await level.selectOption("off");
  await expect(level).toHaveValue("off");
  await a.reload();
  await expect(
    a.getByRole("main").getByRole("combobox", { name: strings.notification_settings_title }),
  ).toHaveValue("off");

  // Björn reacts to a post in each; the count shows each reaction landed.
  for (const [address, text] of [
    [quiet, "Fundur í rólega hópnum"],
    [loud, "Fundur í hávaðahópnum"],
  ] as const) {
    await b.goto(address);
    const card = post(b, text);
    await card.getByRole("button", { name: strings.post_like, exact: true }).click();
    await expect(card.getByText(strings.reaction_count({ count: 1 }))).toBeVisible();
  }
  await runJobs();

  await a.goto(WEB);
  await a.getByRole("link", { name: new RegExp(strings.notifications_title) }).click();
  const reacted = a
    .getByRole("listitem")
    .filter({
      has: a.getByText(strings.notice_reaction({ name: "Björn Prófsson" }), { exact: true }),
    });
  // The row of the community left alone is there, so an empty list cannot pass for the quiet one.
  await expect(reacted.filter({ hasText: loudName })).toHaveCount(1);
  await expect(reacted.filter({ hasText: quietName })).toHaveCount(0);
});
