import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { layoutOf } from "../src/ui/layout.ts";
import { signIn } from "./accounts.ts";
import { CLIENT, expect, serveOrigin, test, WEB } from "./origin.ts";
import { newGoogleSubject } from "./people.ts";
import { awaited, phone, serveSocket } from "./phone.ts";

// A real browser and a phone through the Worker (decisions 0064, 0081). The
// browser runs the core in its worker; the phone is the Rust client in
// core/client/tests/browser.rs (a_phone_links_a_real_browser). The two meet in
// a directory: this side writes `subject` and `code`, the phone writes `ready`
// once its conversation has a message, and its test passes once the
// browser's reply has reached the other account. interop.yml runs it.

test.skip(!process.env.SPJALL_BROWSER_PHONE, "interop.yml runs it beside the phone's half");

/** The id of the linked browser among the devices `/v1/me` lists. */
function browserDevice(me: unknown): string | undefined {
  if (typeof me !== "object" || me === null || !("devices" in me) || !Array.isArray(me.devices))
    return undefined;
  for (const d of me.devices as unknown[]) {
    if (typeof d === "object" && d !== null && "kind" in d && d.kind === "web") {
      if ("deviceId" in d && typeof d.deviceId === "string") return d.deviceId;
    }
  }
  return undefined;
}

test("a phone links this browser, which shows the phone's message and replies", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  const dir = await mkdtemp(join(tmpdir(), "spjall-browser-"));
  const subject = newGoogleSubject();
  const phoneDone = phone(dir, "a_phone_links_a_real_browser");

  await serveSocket(page);
  await signIn(page, "Vafri Prófsson", subject);
  await writeFile(join(dir, "subject"), subject);
  await awaited(dir, "ready");

  // Nothing is linked yet: the page offers the link and shows its code.
  await page.goto(`${WEB}/conversations`);
  await page.getByRole("button", { name: strings.device_link_web_start }).click();
  const code = (await page.locator("code").textContent()) ?? "";
  expect(code).not.toBe("");
  // A phone browser loses the page while the person approves in the app; the
  // link it began goes on after a reload (0096).
  await page.reload();
  await expect(page.locator("code")).toHaveText(code);
  await writeFile(join(dir, "code"), code);

  // The phone approves with its history, and the conversation arrives.
  const conversation = page.getByRole("main").getByRole("listitem").getByRole("link");
  await expect(conversation).toHaveCount(1, { timeout: 120_000 });
  await conversation.click();
  await expect(page.getByText("halló vafri", { exact: true })).toBeVisible();
  // An expanded window keeps the list beside the open conversation (0093).
  const beside = layoutOf(page.viewportSize()!.width).conversations === "list-and-thread";
  await expect(conversation).toHaveCount(beside ? 1 : 0);
  await expect(page.getByRole("link", { name: strings.back })).toHaveCount(beside ? 0 : 1);

  await page.getByRole("textbox", { name: strings.composer_placeholder }).fill("svar úr vafra");
  await page.getByRole("button", { name: strings.send }).click();
  await expect(page.getByText("svar úr vafra", { exact: true })).toBeVisible();

  // A second tab of the same browser finds the chat open in the first.
  const second = await page.context().newPage();
  await serveOrigin(second);
  await serveSocket(second);
  await second.goto(`${WEB}/conversations`);
  await expect(
    second.getByRole("status").filter({ hasText: strings.chat_other_tab }),
  ).toBeVisible();

  // Another session of the same account revokes this browser's device (#156).
  // The server closes the socket with 4401, and the page, without a reload,
  // ends the session at once rather than reconnecting with backoff.
  await second.close();
  await page.goBack();
  await expect(conversation).toHaveCount(1);
  // The row says who said the last thing: here the reader.
  await expect(conversation).toContainText(strings.last_line_own({ text: "svar úr vafra" }));

  // Away from the conversations, the other person writes. This tab and one with the
  // store held elsewhere count it, and neither shows the words (0124).
  const unread = strings.unread_count({ count: 1 });
  const place = (on: Page) => on.getByRole("link", { name: strings.tab_conversations });
  await page.getByRole("link", { name: strings.notifications_title }).click();
  const away = await page.context().newPage();
  await serveOrigin(away);
  await serveSocket(away);
  await away.goto(`${WEB}/communities`);
  await writeFile(join(dir, "away"), "go");
  await expect(place(page)).toContainText(unread, { timeout: 30_000 });
  // A fresh tab shows the server's page first: it counts once it has loaded its scripts.
  await expect(place(away)).toContainText(unread, { timeout: 30_000 });
  const who = page.getByRole("region", { name: strings.notifications_conversations_unread });
  await expect(who).toContainText(unread);
  await expect(page.getByText("annað frá öðrum")).toHaveCount(0);
  expect(await phoneDone).toBe(0);

  // Reading it clears the count in both tabs.
  await who.getByRole("link").click();
  await expect(page.getByText("annað frá öðrum", { exact: true })).toBeVisible();
  await expect(place(page)).not.toContainText(unread);
  await expect(place(away)).not.toContainText(unread);
  await away.close();

  const other = await page.context().browser()!.newContext();
  const elsewhere = await other.newPage();
  await serveOrigin(elsewhere);
  await signIn(elsewhere, "Vafri Prófsson", subject);
  const mine: unknown = await elsewhere.evaluate(async (h) => {
    const body: unknown = await (await fetch("/v1/me", { headers: h })).json();
    return body;
  }, CLIENT);
  const deviceId = browserDevice(mine);
  expect(deviceId).toBeDefined();
  const revoked = await elsewhere.evaluate(
    async ([id, h]) => (await fetch(`/v1/devices/${id}`, { method: "DELETE", headers: h })).status,
    [encodeURIComponent(deviceId!), CLIENT] as const,
  );
  expect(revoked).toBe(204);
  await expect(page.getByRole("alert").filter({ hasText: strings.chat_device_lost })).toBeVisible({
    timeout: 5_000,
  });
  await other.close();
});
