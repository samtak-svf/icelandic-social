import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { expectLoaded, png } from "./images.ts";
import { CLIENT, expect, serveOrigin, test, WEB } from "./origin.ts";
import { addMark, signIn, signInVerified } from "./accounts.ts";
import { newGoogleSubject, newKennitala } from "./people.ts";

// The signed-in web app (#284): signing in from its own page, Ég, settings,
// the session list and signing out, all through what a person sees. The name
// is not edited because no one can edit it (decision 0043): it comes from
// Google or from Kenni, so the photo is what Ég changes. However much is done
// here, the browser never becomes a device.

const NAME = "Prófa Prófsdóttir";

/** The account, as the API describes it to this browser. */
async function me(page: Page): Promise<unknown> {
  return page.evaluate(async (headers) => {
    const answer = await fetch("/v1/me", { headers });
    const body: unknown = await answer.json();
    return body;
  }, CLIENT);
}

test("offers only Google to sign in: Kenni is no way in", async ({ page }) => {
  await page.goto(`${WEB}/`);
  await page.getByRole("heading", { name: strings.sign_in_title }).waitFor();
  await expect(page.locator('a[href^="/auth/"]')).toHaveCount(1);
  await expect(page.getByRole("link", { name: strings.sign_in_google })).toBeVisible();
  await expect(page.locator('a[href^="/auth/kenni"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: strings.privacy_title })).toBeVisible();
  await expect(page.getByRole("link", { name: strings.support_title })).toBeVisible();
});

test("adds the mark with Kenni from Ég and shows the verified name", async ({ page }) => {
  await signInVerified(page, NAME);
  await expect(page.getByRole("link", { name: strings.verify_cta })).toHaveCount(0);
  await expect(page.getByRole("link", { name: strings.tab_me })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(await me(page)).toMatchObject({ verified: true, devices: [] });
});

test("says when the kennitala already holds another account with Google", async ({
  page,
  browser,
}) => {
  const kennitala = newKennitala();
  const other = await browser.newContext();
  const first = await other.newPage();
  await serveOrigin(first);
  await signIn(first, NAME);
  await addMark(first, NAME, kennitala);
  await signIn(page, NAME);
  await addMark(page, NAME, kennitala);
  await expect(page.getByRole("alert")).toHaveText(strings.identity_taken);
  expect(await me(page)).toMatchObject({ verified: false });
  await other.close();
});
test("sets, changes and removes the photo on Ég", async ({ page }) => {
  await signIn(page, NAME);
  await expect(page.getByText(strings.verified_short)).toHaveCount(0);
  const photo = page.getByRole("img", { name: strings.photo_own_alt });
  await expect(photo).toHaveCount(0);

  const file = { name: "mynd.png", mimeType: "image/png", buffer: await png(page) };
  const sheet = page.getByRole("dialog", { name: strings.image_frames_title });
  // The camera on the avatar opens the photo controls; a change closes them.
  await page.getByRole("button", { name: strings.photo_choose }).click();
  await page.getByRole("dialog").getByLabel(strings.photo_choose).setInputFiles(file);
  await sheet.getByRole("button", { name: strings.save }).click();
  await expect(photo).toBeVisible();
  await expectLoaded(photo);

  await page.getByRole("button", { name: strings.photo_change }).click();
  await page.getByRole("dialog").getByLabel(strings.photo_change).setInputFiles(file);
  await sheet.getByRole("button", { name: strings.save }).click();
  await expect(sheet).toHaveCount(0);
  await expect(photo).toBeVisible();

  await page.getByRole("button", { name: strings.photo_change }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: strings.photo_remove }).click();
  await expect(photo).toHaveCount(0);
  await expect(page.getByRole("button", { name: strings.photo_choose })).toBeVisible();

  await page.reload();
  await expect(page.getByText(NAME)).toBeVisible();
  await expect(photo).toHaveCount(0);
  expect(await me(page)).toMatchObject({ devices: [] });
});

test("ends another browser's session from settings", async ({ page, browser }) => {
  const person = newGoogleSubject();
  const other = await browser.newContext();
  const elsewhere = await other.newPage();
  await serveOrigin(elsewhere);
  await signIn(elsewhere, NAME, person);
  await signIn(page, NAME, person);

  await page.getByRole("link", { name: strings.settings_title }).click();
  await expect(page.getByRole("heading", { name: strings.sessions_title })).toBeVisible();
  const rows = page
    .getByRole("list")
    .filter({ hasText: strings.session_this })
    .getByRole("listitem");
  await expect(rows).toHaveCount(2);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: `${strings.session_end}:` }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(strings.session_this);

  await elsewhere.reload();
  await expect(elsewhere.getByRole("heading", { name: strings.sign_in_title })).toBeVisible();
  expect(await me(page)).toMatchObject({ devices: [] });
  await other.close();
});

test("signs out from settings", async ({ page }) => {
  await signIn(page, NAME);
  await page.getByRole("link", { name: strings.settings_title }).click();
  await page.getByRole("button", { name: strings.sign_out, exact: true }).click();
  await expect(page.getByRole("heading", { name: strings.sign_in_title })).toBeVisible();
  expect((await page.context().cookies(WEB)).map((c) => c.name)).not.toContain("__Host-session");

  await page.reload();
  await expect(page.getByRole("heading", { name: strings.sign_in_title })).toBeVisible();
});
