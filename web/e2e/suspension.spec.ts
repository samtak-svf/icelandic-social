import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import type { Browser, Locator, Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { formatIsDateTime } from "../src/lib/is-format.ts";
import { addMark, signIn } from "./accounts.ts";
import { CLIENT, expect, test, WEB } from "./origin.ts";
import { newGoogleSubject } from "./people.ts";
import { awaited, phone, serveSocket } from "./phone.ts";
import {
  accountOf,
  found,
  join,
  person,
  platformModerator,
  post,
  write,
} from "./social-helpers.ts";

// What a suspended account sees (decision 0115), where the layout is what holds:
// a disabled Líkar looks disabled, the notice stands above a community and is not
// on a conversation page, where the composer has to stay in the viewport of a
// phone. A conversation needs a phone's half, so that test runs in interop.yml.

const PHONE_SIZE = { width: 390, height: 844 };

const opacityOf = (button: Locator) =>
  button.evaluate((element) => Number(getComputedStyle(element).opacity));

/** The end date on the newest statement of the person in `page`; null when it has none. */
const endOfSuspension = (page: Page) =>
  page.evaluate(async (headers) => {
    const answer = await fetch("/v1/moderation/statements", { headers });
    const body: unknown = await answer.json();
    const newest: unknown =
      typeof body === "object" &&
      body !== null &&
      "statements" in body &&
      Array.isArray(body.statements)
        ? body.statements[0]
        : null;
    return typeof newest === "object" &&
      newest !== null &&
      "until" in newest &&
      typeof newest.until === "number"
      ? newest.until
      : null;
  }, CLIENT);

const noticeOn = (page: Page) =>
  page.getByRole("status").filter({ hasText: strings.statement_open });

/** `page` reported by an owner and suspended for a time from the queue; its community. */
async function suspendForATime(browser: Browser, page: Page, before: () => Promise<void>) {
  const owner = await person(browser, "Eigandi Bannsdóttir");
  const actor = await person(browser, "Umsjón Bannsson");
  await platformModerator(actor);
  const community = await found(owner, "open");
  await join(page, community);
  await write(page, strings.post_compose, strings.post_publish, "Færsla fyrir bann.");
  await before();

  const accountId = await accountOf(page);
  const filed = await owner.evaluate(
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

  await actor.goto(`${WEB}/moderation`);
  const report = actor.getByRole("article", { name: strings.report_reason_harassment });
  await report.getByLabel(strings.report_reason).fill("Ítrekuð áreitni");
  await report.getByLabel(strings.moderation_mute_for).selectOption({ index: 1 });
  actor.once("dialog", (dialog) => void dialog.accept());
  await report.getByRole("button", { name: strings.platform_suspend }).click();
  await expect(report).toHaveCount(0);
  return community;
}

test("a suspended account sees the notice, a Líkar that looks disabled and how long it was for", async ({
  browser,
}) => {
  test.slow();
  const page = await person(browser, "Sveinn Bannsson");
  const like = post(page, "Færsla fyrir bann.").getByRole("button", {
    name: strings.post_like,
    exact: true,
  });
  const community = await suspendForATime(browser, page, async () => {
    // Before the suspension: the same button at full strength, so that the
    // measurement below is shown to measure something.
    await expect(like).toBeEnabled();
    expect(await opacityOf(like)).toBe(1);
  });

  await page.goto(community);
  await expect(noticeOn(page)).toBeVisible();
  await expect(like).toBeDisabled();
  expect(await opacityOf(like)).toBeLessThan(1);

  const until = await endOfSuspension(page);
  expect(until).not.toBeNull();
  await page.goto(`${WEB}/statements`);
  await expect(
    page.getByRole("article", {
      name: strings.moderation_decision_suspend_account_until({
        date: formatIsDateTime(until ?? 0),
      }),
    }),
  ).toContainText("Ítrekuð áreitni");
  await expect(noticeOn(page)).toBeVisible();

  // The list of conversations carries no notice, at a phone's size either.
  await page.setViewportSize(PHONE_SIZE);
  await page.goto(`${WEB}/conversations`);
  await expect(page.getByRole("button", { name: strings.device_link_web_start })).toBeVisible();
  await expect(noticeOn(page)).toHaveCount(0);
});

test.describe("beside a phone", () => {
  test.skip(!process.env.SPJALL_BROWSER_PHONE, "interop.yml runs it beside the phone's half");
  test("a suspended account's conversation has no notice, and its composer stays in the viewport", async ({
    page,
    browser,
  }) => {
    test.setTimeout(8 * 60_000);
    const dir = await mkdtemp(joinPath(tmpdir(), "spjall-suspension-"));
    const subject = newGoogleSubject();
    const phoneDone = phone(dir, "a_phone_links_a_real_browser");

    const name = "Svana Bannsdóttir";
    await serveSocket(page);
    await signIn(page, name, subject);
    await addMark(page, name);
    await expect(page.getByRole("status").filter({ hasText: strings.verify_linked })).toBeVisible();
    await writeFile(joinPath(dir, "subject"), subject);
    await awaited(dir, "ready");
    await suspendForATime(browser, page, () => Promise.resolve());

    await page.setViewportSize(PHONE_SIZE);
    await page.goto(`${WEB}/conversations`);
    await page.getByRole("button", { name: strings.device_link_web_start }).click();
    const code = (await page.locator("code").textContent()) ?? "";
    expect(code).not.toBe("");
    await writeFile(joinPath(dir, "code"), code);
    const conversation = page.getByRole("main").getByRole("listitem").getByRole("link");
    await expect(conversation).toHaveCount(1, { timeout: 120_000 });
    await expect(noticeOn(page)).toHaveCount(0);
    await conversation.click();
    await expect(page.getByText("halló vafri", { exact: true })).toBeVisible();
    await expect(noticeOn(page)).toHaveCount(0);
    const composer = page.getByRole("textbox", { name: strings.composer_placeholder });
    await expect(composer).toBeInViewport({ ratio: 1 });

    // A message still goes both ways: the phone's half ends only once the reply arrives.
    await composer.fill("svar úr vafra");
    await page.getByRole("button", { name: strings.send }).click();
    await expect(page.getByText("svar úr vafra", { exact: true })).toBeVisible();
    await writeFile(joinPath(dir, "away"), "go");
    expect(await phoneDone).toBe(0);
  });
});
