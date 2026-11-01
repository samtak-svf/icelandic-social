import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strings } from "../src/generated/brand/strings.ts";
import { signIn } from "./accounts.ts";
import { expect, test, WEB } from "./origin.ts";
import { newGoogleSubject } from "./people.ts";
import { awaited, phone, serveSocket } from "./phone.ts";

// A browser managing a group a phone made (decision 0078): it adds a person,
// removes another, names the group and leaves it. The phone's half is
// core/client/tests/browser.rs (a_browser_manages_a_group): it makes the
// group, links this browser, and checks each change from the side of a
// member who stays. interop.yml runs it beside that half.

test.skip(!process.env.SPJALL_BROWSER_PHONE, "interop.yml runs it beside the phone's half");

test("a browser adds a person, removes a member, names a group and leaves it", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const dir = await mkdtemp(join(tmpdir(), "spjall-group-"));
  const subject = newGoogleSubject();
  const phoneDone = phone(dir, "a_browser_manages_a_group");

  await serveSocket(page);
  await signIn(page, "Hópstjóri Prófsson", subject);
  await writeFile(join(dir, "subject"), subject);
  await awaited(dir, "ready");
  const second = await awaited(dir, "second");
  const third = await awaited(dir, "third");
  const fourth = await awaited(dir, "fourth");

  await page.goto(`${WEB}/conversations`);
  await page.getByRole("button", { name: strings.device_link_web_start }).click();
  await writeFile(join(dir, "code"), (await page.locator("code").textContent()) ?? "");

  // The group arrives with its history; its title opens the group's page.
  const conversation = page.getByRole("main").getByRole("listitem").getByRole("link");
  await expect(conversation).toHaveCount(1, { timeout: 120_000 });
  await conversation.click();
  await expect(page.getByText("halló hópur", { exact: true })).toBeVisible();

  // Read: the second member's face comes under the message, and pressing it names them (0125).
  await page.getByRole("button", { name: strings.read_by_faces({ names: second }) }).click();
  const readers = page.getByRole("dialog", { name: strings.read_by_title });
  await expect(readers.getByText(second, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(readers).toHaveCount(0);

  await page.getByRole("link", { name: strings.conversation_info }).click();
  const members = page.getByRole("region", { name: strings.group_member_count({ count: 2 }) });
  await expect(members).toBeVisible();

  // Add people (the list leaves out this account): the fourth is found by name, ticked and added.
  await page.getByRole("button", { name: strings.add_people, exact: true }).click();
  await page.getByRole("searchbox", { name: strings.people_search }).fill(fourth);
  await page.getByRole("checkbox", { name: fourth }).check();
  await page.getByRole("button", { name: strings.add_people_confirm }).click();
  await expect(
    page.getByRole("region", { name: strings.group_member_count({ count: 3 }) }),
  ).toBeVisible();
  await expect(page.getByText(fourth, { exact: true })).toBeVisible();

  // Remove a member: asked first, then gone.
  await page
    .getByRole("listitem")
    .filter({ hasText: third })
    .getByRole("button", { name: strings.remove_member })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText(third);
  await page.getByRole("alertdialog").getByRole("button", { name: strings.remove_member }).click();
  await expect(page.getByText(third, { exact: true })).toHaveCount(0);

  // Name the group; the name shows on the page.
  await page.getByRole("button", { name: strings.group_name, exact: true }).click();
  await page.getByRole("textbox", { name: strings.group_name_title }).fill("Hópur vafra");
  await page.getByRole("button", { name: strings.save }).click();
  await expect(page.getByText("Hópur vafra").first()).toBeVisible();

  // Leave: asked first, then back in the list of conversations.
  await page.getByRole("button", { name: strings.leave_group }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: strings.leave_group }).click();
  await page.waitForURL(`${WEB}/conversations`);

  expect(await phoneDone).toBe(0);
  expect(await readFile(join(dir, "ready"), "utf8")).not.toBe("");
});
