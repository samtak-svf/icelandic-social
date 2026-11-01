import { strings } from "../src/generated/brand/strings.ts";
import { expectLoaded } from "./images.ts";
import { expect, test, WEB } from "./origin.ts";

// The pages anyone reads without signing in: the privacy policy and support
// (#383), linked from settings and store listings, and the tester guide (#350).

test("serves public /privacy and /support pages without signing in and from settings", async ({
  page,
}) => {
  await page.goto(WEB);
  await page.getByRole("link", { name: strings.privacy_title }).click();
  await expect(page.getByRole("heading", { level: 1, name: strings.privacy_title })).toBeVisible();
  await expect(page.getByText(strings.residency_claim)).toBeVisible();
  await page.getByRole("link", { name: strings.support_title }).click();
  await expect(page.getByRole("heading", { level: 1, name: strings.support_title })).toBeVisible();
  await expect(page.getByText(strings.support_contact_body)).toBeVisible();
});

test("serves the public tester guide from the sign-in screen, with both platforms' steps", async ({
  page,
}) => {
  await page.goto(WEB);
  await page.getByRole("link", { name: strings.testers_title }).click();
  await expect(page).toHaveURL(/\/testers$/);
  await expect(page.getByRole("heading", { level: 1, name: strings.testers_title })).toBeVisible();
  await expect(page.getByText(strings.testers_unreviewed_body)).toBeVisible();
  await page.getByRole("link", { name: strings.testers_iphone_heading, exact: true }).click();
  await expect(page).toHaveURL(/#iphone$/);
  const iphone = page.locator("section#iphone");
  await expect(iphone.getByRole("listitem")).toHaveCount(5);
  await expect(iphone.getByText(strings.testers_iphone_step_testflight)).toBeVisible();
  const android = page.locator("section#android");
  await expect(android.getByRole("listitem")).toHaveCount(5);
  const shots = [
    strings.testers_image_play_invite_alt,
    strings.testers_image_play_tester_alt,
    strings.testers_image_play_listing_alt,
  ];
  await expect(android.getByRole("img")).toHaveCount(shots.length);
  for (const alt of shots) {
    const img = android.getByRole("img", { name: alt, exact: true });
    await img.scrollIntoViewIfNeeded();
    await expect(img).toBeVisible();
    await expectLoaded(img);
  }
});
