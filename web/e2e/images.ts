import type { Locator, Page } from "@playwright/test";
import { expect } from "./origin.ts";

/** A PNG the browser draws, so no image sits in the repo. */
export async function png(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(640, 480);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = "#3a7";
    context.fillRect(0, 0, 640, 480);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return Buffer.from(bytes);
}

/**
 * The image has drawn. An image is visible from its layout box, before its bytes arrive, so this
 * waits: one read straight after a visibility check is a race the slower run loses.
 */
export async function expectLoaded(image: Locator): Promise<void> {
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
}
