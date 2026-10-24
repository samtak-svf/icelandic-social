import { strings } from "../src/generated/brand/strings.ts";
import { found, join, manage, person, post, write } from "./social-helpers.ts";
import { expect, test } from "./origin.ts";

// An anonymous post is approved before it shows and names no author (decision 0091).

test("an anonymous post waits for approval, shows no name, and a moderator can reveal it", async ({
  browser,
}) => {
  test.slow();
  const owner = await person(browser, "Eigandi Nafnlausdóttir");
  const address = await found(owner, "open");

  // The owner turns the switch on in Breyta samfélagi.
  await manage(owner);
  await owner.locator("summary", { hasText: strings.community_edit }).click();
  await owner.getByRole("switch", { name: new RegExp(strings.community_anonymous_posts) }).check();
  await owner.getByRole("button", { name: strings.community_edit }).last().click();

  // A post under the owner's name, so a reader's feed has loaded when it shows.
  await owner.goto(address);
  await write(owner, strings.post_compose, strings.post_publish, "Velkomin í hópinn");

  // A member posts anonymously: it is theirs, and waiting.
  const author = await person(browser, "Höfundur Falinsson");
  await join(author, address);
  await author.getByRole("button", { name: strings.post_compose_prompt }).click();
  const dialog = author.getByRole("dialog");
  await dialog.getByLabel(strings.post_compose).fill("Spurning sem ég þori ekki að spyrja");
  await dialog.getByRole("switch", { name: new RegExp(strings.composer_anonymous) }).check();
  await dialog.getByRole("button", { name: strings.post_publish }).click();
  await expect(author.getByRole("dialog")).toHaveCount(0);

  // A reader sees nothing yet: the feed has loaded, and the post is not in it.
  const reader = await person(browser, "Lesandi Prófsson");
  await join(reader, address);
  await expect(post(reader, "Velkomin í hópinn")).toBeVisible();
  await expect(post(reader, "Spurning sem ég þori ekki að spyrja")).toHaveCount(0);

  // The owner approves it from the queue, after the count shows.
  await owner.goto(address);
  await manage(owner);
  await owner.getByRole("link", { name: strings.anonymous_queue_waiting({ count: 1 }) }).click();
  await expect(owner.getByText("Spurning sem ég þori ekki að spyrja")).toBeVisible();
  await expect(owner.getByText("Höfundur Falinsson")).toHaveCount(0);

  // Reveal names the author, and the log records it.
  owner.once("dialog", (d) => void d.accept());
  await owner.getByRole("button", { name: strings.anonymous_reveal }).click();
  await expect(
    owner.getByText(strings.anonymous_revealed({ name: "Höfundur Falinsson" })),
  ).toBeVisible();
  await owner.getByRole("button", { name: strings.anonymous_approve }).click();
  await expect(owner.getByText(strings.anonymous_queue_empty)).toBeVisible();
  await owner.goto(address);
  await manage(owner);
  await expect(
    owner
      .getByRole("region", { name: strings.moderation_log_title })
      .getByText(strings.moderation_log_author_revealed),
  ).toBeVisible();

  // Readers now see the post under the neutral byline; the author sees theirs.
  await reader.reload();
  const seen = post(reader, "Spurning sem ég þori ekki að spyrja");
  await expect(seen.getByText(strings.post_anonymous_author)).toBeVisible();
  await expect(seen.getByText("Höfundur Falinsson")).toHaveCount(0);
  await author.reload();
  await expect(
    post(author, "Spurning sem ég þori ekki að spyrja").getByText(strings.post_anonymous_mine),
  ).toBeVisible();
});
