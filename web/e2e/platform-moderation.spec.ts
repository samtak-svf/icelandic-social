import { strings } from "../src/generated/brand/strings.ts";
import { png } from "./images.ts";
import {
  cardMenu,
  found,
  join,
  person,
  platformModerator,
  post,
  runJobs,
  write,
} from "./social-helpers.ts";
import { CLIENT, expect, test, WEB } from "./origin.ts";

// Samtak's own moderation screen (#374, decision 0115): an account reported
// as harassment reaches the platform queue, a platform moderator clears its
// photo from there, and the report leaves the queue and the entry
// reaches the log. Nobody else is shown the queue. The person is told why and
// may ask once for a review, which a moderator who did not act decides.

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
  const accountId = await author.evaluate(async (headers) => {
    const answer = await fetch("/v1/me", { headers });
    const body: unknown = await answer.json();
    return typeof body === "object" && body !== null && "accountId" in body
      ? String(body.accountId)
      : "";
  }, CLIENT);
  expect(accountId).not.toBe("");
  const filed = await reporter.evaluate(
    async ([id, client]) => {
      const answer = await fetch("/v1/reports", {
        method: "POST",
        headers: { ...client, "content-type": "application/json" },
        body: JSON.stringify({ target: { kind: "account", id }, reason: "harassment", note: "" }),
      });
      return answer.status;
    },
    [accountId, CLIENT] as const,
  );
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

  // The author is told why, and that one review may be asked for.
  await author.goto(`${WEB}/statements`);
  const stated = author.getByRole("article", {
    name: strings.moderation_decision_clear_account_photo,
  });
  await expect(stated).toContainText("Ólögleg mynd");
  await expect(stated.getByRole("button", { name: strings.statement_ask })).toBeVisible();

  // Someone without the role is refused and shown no queue.
  await outsider.goto(`${WEB}/moderation`);
  await expect(outsider.getByText(strings.problem_not_permitted)).toBeVisible();
  await expect(outsider.getByRole("article")).toHaveCount(0);
});

test("a platform moderator removes an unlawful post reported in a community", async ({
  browser,
}) => {
  test.slow();
  const owner = await person(browser, "Eigandi Fjarlægingardóttir");
  const member = await person(browser, "Meðlimur Fjarlægingarson");
  const platform = await person(browser, "Umsjón Fjarlægingarson");
  await platformModerator(platform);
  const community = await found(owner, "open");
  await write(owner, strings.post_compose, strings.post_publish, "Ólöglegt efni í færslu.");
  await join(member, community);

  // The member reports it as unlawful, which goes to Samtak and not the community.
  const reported = post(member, "Ólöglegt efni í færslu.");
  await cardMenu(reported, strings.report);
  await reported.getByLabel(strings.report_reason_unlawful).check();
  await reported.getByRole("button", { name: strings.report_send }).click();
  await expect(reported.getByText(strings.report_sent)).toBeVisible();

  // The platform moderator sees it with its content and removes it.
  await platform.goto(`${WEB}/moderation`);
  const report = platform.getByRole("article", { name: strings.report_reason_unlawful });
  await expect(report).toContainText("Ólöglegt efni í færslu.");
  await report.getByLabel(strings.report_reason).fill("Ólöglegt");
  platform.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(strings.platform_remove_confirm);
    void dialog.accept();
  });
  await report.getByRole("button", { name: strings.moderation_remove }).click();
  await expect(report).toHaveCount(0);
  await expect(platform.getByText(strings.moderation_decision_remove_post)).toBeVisible();

  // An ordinary member no longer reads it, and sees that a moderator removed something.
  await member.goto(community);
  await expect(member.getByText(strings.content_removed)).toBeVisible();
  await expect(post(member, "Ólöglegt efni í færslu.")).toHaveCount(0);
});

test("the author of a removed post asks once, and another moderator overturns it", async ({
  browser,
}) => {
  test.slow();
  const owner = await person(browser, "Eigandi Endurskoðunardóttir");
  const author = await person(browser, "Höfundur Endurskoðunarson");
  const member = await person(browser, "Meðlimur Endurskoðunardóttir");
  const actor = await person(browser, "Umsjón Endurskoðunarson");
  const other = await person(browser, "Umsjón Endurskoðunardóttir");
  await platformModerator(actor);
  await platformModerator(other);
  const community = await found(owner, "open");
  await join(author, community);
  await join(member, community);
  await write(author, strings.post_compose, strings.post_publish, "Færsla til endurskoðunar.");

  // A member reports it as unlawful and a platform moderator removes it.
  const reported = post(member, "Færsla til endurskoðunar.");
  await member.reload();
  await cardMenu(reported, strings.report);
  await reported.getByLabel(strings.report_reason_unlawful).check();
  await reported.getByRole("button", { name: strings.report_send }).click();
  await expect(reported.getByText(strings.report_sent)).toBeVisible();
  await actor.goto(`${WEB}/moderation`);
  const report = actor.getByRole("article", { name: strings.report_reason_unlawful });
  await report.getByLabel(strings.report_reason).fill("Ástæða stjórnanda");
  actor.once("dialog", (dialog) => void dialog.accept());
  await report.getByRole("button", { name: strings.moderation_remove }).click();
  await expect(report).toHaveCount(0);

  // A member sees the tombstone and no text; the author is led to the reasons.
  await member.goto(community);
  await expect(member.getByText(strings.content_removed)).toBeVisible();
  await expect(member.getByText("Færsla til endurskoðunar.")).toHaveCount(0);
  await expect(member.getByRole("link", { name: strings.statement_open })).toHaveCount(0);
  await runJobs();
  await author.goto(`${WEB}/notifications`);
  await expect(author.getByText(strings.notice_moderated)).toBeVisible();
  await author.getByRole("link", { name: strings.notice_moderated }).click();
  await expect(author).toHaveURL(/\/statements$/);
  await author.goto(community);
  await author.getByRole("link", { name: strings.statement_open }).click();

  // The statement tells which item and why, and never who acted.
  const stated = author.getByRole("article", { name: strings.moderation_decision_remove_post });
  await expect(stated).toContainText("Ástæða stjórnanda");
  await expect(stated).toContainText("Færsla til endurskoðunar.");
  await expect(stated).not.toContainText("Umsjón Endurskoðunarson");
  await expect(stated).toContainText(strings.statement_ask_once);

  // The author asks, once.
  author.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(strings.statement_ask_confirm);
    void dialog.accept();
  });
  await stated.getByRole("button", { name: strings.statement_ask }).click();
  await expect(stated).toContainText(strings.statement_review_open);
  await expect(stated.getByRole("button", { name: strings.statement_ask })).toHaveCount(0);

  // The moderator who acted may not answer; the other may.
  await actor.goto(`${WEB}/moderation`);
  const own = actor.getByRole("article", { name: strings.moderation_decision_remove_post });
  await expect(own).toContainText(strings.platform_review_not_yours);
  await expect(own.getByRole("button", { name: strings.platform_review_overturn })).toHaveCount(0);

  await other.goto(`${WEB}/moderation`);
  const waiting = other.getByRole("article", { name: strings.moderation_decision_remove_post });
  await expect(waiting).toContainText("Færsla til endurskoðunar.");
  await waiting.getByLabel(strings.report_reason).fill("Ekkert brot");
  other.once("dialog", (dialog) => {
    expect(dialog.message()).toBe(strings.platform_review_overturn_confirm);
    void dialog.accept();
  });
  await waiting.getByRole("button", { name: strings.platform_review_overturn }).click();
  await expect(other.getByText(strings.platform_reviews_empty)).toBeVisible();
  await expect(other.getByText(strings.moderation_log_review_overturned)).toBeVisible();

  // The post is back, and the author is told.
  await member.goto(community);
  await expect(post(member, "Færsla til endurskoðunar.")).toBeVisible();
  await runJobs();
  await author.goto(`${WEB}/notifications`);
  await expect(author.getByText(strings.notice_review_overturned)).toBeVisible();
  await author.goto(`${WEB}/statements`);
  const answered = author.getByRole("article", { name: strings.moderation_decision_remove_post });
  await expect(answered).toContainText(strings.statement_review_overturned);
  await expect(answered).toContainText("Ekkert brot");
});
