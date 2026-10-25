import { strings } from "../src/generated/brand/strings.ts";
import { png } from "./images.ts";
import { found, person, post, write } from "./social-helpers.ts";
import { expect, test } from "./origin.ts";

// A comment's image and the full-screen viewer (decision 0082).

test("a comment carries one image, alone or with text, opened in the viewer", async ({
  browser,
}) => {
  const owner = await person(browser, "Myndasmiður Prófsdóttir");
  await found(owner, "open");
  await write(owner, strings.post_compose, strings.post_publish, "Mynd í athugasemd.");
  await post(owner, "Mynd í athugasemd.")
    .getByRole("link", { name: strings.post_comment_action, exact: true })
    .click();

  // An image alone enables send; a second is not offered; remove takes it back.
  const send = owner.getByRole("button", { name: strings.comment_publish, exact: true });
  const pick = owner.getByLabel(strings.comment_add_image);
  const image = { name: "mynd.png", mimeType: "image/png", buffer: await png(owner) };
  await expect(send).toBeDisabled();
  await pick.setInputFiles(image);
  await expect(send).toBeEnabled();
  await expect(pick).toBeDisabled();
  await owner.getByRole("button", { name: strings.post_image_remove }).click();
  await expect(send).toBeDisabled();
  await expect(pick).toBeEnabled();

  // Sent with no text, it stands in the thread.
  await pick.setInputFiles(image);
  await send.click();
  const bubble = owner
    .getByRole("article")
    .filter({ has: owner.getByRole("button", { name: strings.comment_image_alt }) });
  const opener = bubble.getByRole("button", { name: strings.comment_image_alt });
  await expect(opener).toBeVisible();
  await expect
    .poll(() =>
      opener.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
    )
    .toBeGreaterThan(0);

  // It opens in the viewer; Escape closes it and focus returns to the image.
  await opener.click();
  const viewer = owner.getByRole("dialog", { name: strings.image_viewer });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("img", { name: strings.comment_image_alt })).toBeVisible();
  await owner.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(opener).toBeFocused();

  // The close button leaves it too.
  await opener.click();
  await viewer.getByRole("button", { name: strings.close }).click();
  await expect(viewer).toHaveCount(0);
});
