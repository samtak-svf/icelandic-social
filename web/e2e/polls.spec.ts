import { strings } from "../src/generated/brand/strings.ts";
import { cardMenu, found, join, openComposer, person, post } from "./social-helpers.ts";
import { expect, test } from "./origin.ts";

// A poll is counted and never shown (decision 0090).

test("a poll shows its total until you vote, then results; the author closes it", async ({
  browser,
}) => {
  const author = await person(browser, "Könnunarsmiður Prófsdóttir");
  const address = await found(author, "open");

  await openComposer(author);
  const dialog = author.getByRole("dialog");
  await dialog.getByLabel(strings.post_compose).fill("Hvar á fundurinn að vera?");
  await dialog.getByRole("button", { name: strings.composer_poll }).click();
  const publish = dialog.getByRole("button", { name: strings.post_publish });
  await expect(publish).toBeDisabled();
  await dialog.getByLabel(strings.composer_poll_option({ n: 1 })).fill("Í salnum");
  await dialog.getByLabel(strings.composer_poll_option({ n: 2 })).fill("Á netinu");
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(author.getByRole("dialog")).toHaveCount(0);

  const voter = await person(browser, "Kjósandi Prófsson");
  await join(voter, address);
  const card = post(voter, "Hvar á fundurinn að vera?");
  await expect(card.getByText(strings.poll_votes({ count: 0 }))).toBeVisible();
  await card.getByRole("radio", { name: "Í salnum" }).click();
  await expect(card.getByText("1 · 100 %")).toBeVisible();
  await expect(card.getByText(strings.poll_votes({ count: 1 }))).toBeVisible();

  // Changing the vote moves the count; withdrawing hides the counts again.
  await card.getByRole("radio", { name: "Á netinu" }).click();
  await expect(card.getByText("0 · 0 %")).toBeVisible();
  await card.getByRole("button", { name: strings.poll_withdraw }).click();
  await expect(card.getByText("%")).toHaveCount(0);
  await card.getByRole("radio", { name: "Í salnum" }).click();
  await expect(card.getByText("1 · 100 %")).toBeVisible();

  // The author closes it; a third member sees the final result and cannot vote.
  await author.reload();
  await cardMenu(post(author, "Hvar á fundurinn að vera?"), strings.poll_close);
  await expect(
    post(author, "Hvar á fundurinn að vera?").getByText(strings.poll_closed),
  ).toBeVisible();

  const late = await person(browser, "Seinn Prófsson");
  await join(late, address);
  const final = post(late, "Hvar á fundurinn að vera?");
  await expect(final.getByText("1 · 100 %")).toBeVisible();
  await expect(final.getByText(strings.poll_closed)).toBeVisible();
  await expect(final.getByRole("radio", { name: "Á netinu" })).toBeDisabled();
});
