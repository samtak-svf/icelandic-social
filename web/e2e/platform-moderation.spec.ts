import { strings } from "../src/generated/brand/strings.ts";
import { png } from "./images.ts";
import { person, platformModerator } from "./social-helpers.ts";
import { expect, test, WEB } from "./origin.ts";

// Samtak's own moderation screen (#374, decision 0115): an account reported
// as harassment reaches the platform queue, a platform moderator clears its
// photo from there, and the report leaves the queue and the entry
// reaches the log. Nobody else is shown the queue.

test("a platform moderator clears an account's photo from the queue; others are refused", async ({
  browser,
}) => {
  test.slow();
  const author = await person(browser, "Höfundur Umsjónarson");
  const reporter = await person(browser, "Tilkynnir Umsjónarson");
  const platform = await person(browser, "Umsjón Samtakadóttir");
  const outsider = await person(browser, "Utanaðkomandi Umsjónarson");
  await platformModerator(platform);

  // The author sets a photo.
  const file = { name: "mynd.png", mimeType: "image/png", buffer: await png(author) };
  await author.getByRole("link", { name: strings.tab_me }).click();
  await author.getByLabel(strings.photo_choose).setInputFiles(file);
  await author
    .getByRole("dialog", { name: strings.image_frames_title })
    .getByRole("button", { name: strings.save })
    .click();
  await expect(author.getByRole("img", { name: strings.photo_own_alt })).toBeVisible();

  // The reporter reports the author's account (decision 0115): the web has no
  // button for it yet, so the report is filed through the API as the app would.
  const accountId = await author.evaluate(async () => {
    const answer = await fetch("/v1/me", { headers: { "spjall-client": "web/0.1.0" } });
    const body: unknown = await answer.json();
    return typeof body === "object" && body !== null && "accountId" in body
      ? String(body.accountId)
      : "";
  });
  expect(accountId).not.toBe("");
  const filed = await reporter.evaluate(async (id) => {
    const answer = await fetch("/v1/reports", {
      method: "POST",
      headers: { "spjall-client": "web/0.1.0", "content-type": "application/json" },
      body: JSON.stringify({ target: { kind: "account", id }, reason: "harassment", note: "" }),
    });
    return answer.status;
  }, accountId);
  expect(filed).toBe(204);

  // The platform moderator sees it in the queue and clears the photo.
  await platform.goto(`${WEB}/moderation`);
  const report = platform.getByRole("article", { name: strings.report_reason_harassment });
  await expect(report).toContainText("Höfundur Umsjónarson");
  await report.getByLabel(strings.report_reason).fill("Ólögleg mynd");
  platform.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(strings.platform_clear_photo_confirm);
    void dialog.accept();
  });
  await report.getByRole("button", { name: strings.platform_clear_photo }).click();
  await expect(report).toHaveCount(0);
  await expect(platform.getByText(strings.moderation_queue_empty)).toBeVisible();
  await expect(platform.getByText(strings.moderation_decision_clear_account_photo)).toBeVisible();

  // The photo is gone from the account.
  await author.reload();
  await expect(author.getByRole("img", { name: strings.photo_own_alt })).toHaveCount(0);

  // Someone without the role is refused and shown no queue.
  await outsider.goto(`${WEB}/moderation`);
  await expect(outsider.getByText(strings.problem_not_permitted)).toBeVisible();
  await expect(outsider.getByRole("article")).toHaveCount(0);
});
