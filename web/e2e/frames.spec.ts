import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { layoutOf } from "../src/ui/layout.ts";
import { png } from "./images.ts";
import { expect, test } from "./origin.ts";
import { found, openMenu, person } from "./social-helpers.ts";

// The crop sheet (decision 0086) at the three window size classes: a cover
// offers the quiet link to the advanced panel and never opens it by itself, a
// picture does not offer it at all.

async function manage(page: Page) {
  await openMenu(page);
  await page.getByRole("menuitem", { name: new RegExp(`^${strings.community_manage}`) }).click();
  // Beside the side navigation of an expanded window the details start open (decision 0087).
  if (layoutOf(page.viewportSize()!.width).manage === "one-screen") {
    await page.locator("summary", { hasText: strings.community_edit }).click();
  }
}

async function choose(page: Page, label: string) {
  const image = { name: "mynd.png", mimeType: "image/png", buffer: await png(page) };
  await page.getByLabel(label).setInputFiles(image);
  const sheet = page.getByRole("dialog", { name: strings.image_frames_title });
  await expect(sheet).toBeVisible();
  return sheet;
}

for (const width of [390, 700, 1280]) {
  test(`the crop sheet at ${width} px: the advanced link is for covers and starts closed`, async ({
    browser,
  }) => {
    const owner = await person(browser, "Afmörkunar Prófsdóttir");
    await owner.setViewportSize({ width, height: 900 });
    await found(owner, "open");
    await manage(owner);

    // A picture: one window, no advanced link.
    const picture = await choose(owner, strings.community_picture_choose);
    await expect(picture.getByRole("group")).toHaveCount(1);
    await expect(picture.getByRole("button", { name: strings.image_frames_advanced })).toHaveCount(
      0,
    );
    await picture.getByRole("button", { name: strings.cancel }).click();
    await expect(picture).toHaveCount(0);

    // A cover: one window and the link, closed.
    const cover = await choose(owner, strings.community_cover_choose);
    const link = cover.getByRole("button", { name: strings.image_frames_advanced });
    await expect(link).toHaveAttribute("aria-expanded", "false");
    await expect(cover.getByRole("group")).toHaveCount(1);
    await expect(cover.getByRole("button", { name: strings.image_frames_reset })).toHaveCount(0);

    // Opened, all three frames show: side by side from 600 px, stacked below.
    await link.click();
    await expect(link).toHaveAttribute("aria-expanded", "true");
    const frames = cover.getByRole("group");
    await expect(frames).toHaveCount(3);
    const [a, b] = await Promise.all([frames.nth(0).boundingBox(), frames.nth(1).boundingBox()]);
    if (width < 600) expect(b!.y).toBeGreaterThan(a!.y);
    else expect(b!.x).toBeGreaterThan(a!.x);
    await expect(cover.getByRole("button", { name: strings.image_frames_reset })).toBeVisible();
  });
}
