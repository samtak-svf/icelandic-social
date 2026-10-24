import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { layoutOf } from "../src/ui/layout.ts";
import { png } from "./images.ts";
import { expect, test } from "./origin.ts";
import { found, manage, person } from "./social-helpers.ts";

// The crop sheet (decision 0086) at the three window size classes: a cover
// offers the quiet link to the advanced panel and never opens it by itself, a
// picture does not offer it at all.

async function manageDetails(page: Page) {
  await manage(page);
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
    await manageDetails(owner);

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

test("an advanced drag moves only its own frame, and the saved focus stays (#171)", async ({
  browser,
}) => {
  const owner = await person(browser, "Ítarramma Prófsdóttir");
  await owner.setViewportSize({ width: 1280, height: 900 });
  await found(owner, "open");
  await manageDetails(owner);

  const cover = await choose(owner, strings.community_cover_choose);
  await cover.getByRole("button", { name: strings.image_frames_advanced }).click();
  const frames = cover.getByRole("group");
  await expect(frames).toHaveCount(3);
  const placed = (n: number) => frames.nth(n).locator("img").getAttribute("style");
  const [first, second, third] = await Promise.all([placed(0), placed(1), placed(2)]);

  await frames.nth(0).focus();
  for (let i = 0; i < 3; i++) await owner.keyboard.press("ArrowUp");
  await expect.poll(() => placed(0)).not.toBe(first);
  // The panes not dragged show what will be saved for them: unmoved.
  expect(await placed(1)).toBe(second);
  expect(await placed(2)).toBe(third);

  const sent = owner.waitForRequest(
    (r) => r.method() === "PATCH" && /\/cover\/frames$/.test(r.url()),
  );
  await cover.getByRole("button", { name: strings.save }).click();
  const body: unknown = (await sent).postDataJSON();
  expect(body).toEqual({ focus: { x: 0.5, y: 0.5 }, overrides: { compact: expect.any(Object) } });
});
