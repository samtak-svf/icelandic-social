import { readFile } from "node:fs/promises";
import { strings } from "../src/generated/brand/strings.ts";
import { pageOverflow, person, runJobs } from "./social-helpers.ts";
import { expect, test, WEB } from "./origin.ts";

// A person takes their own content out (decision 0126), through what they see: the settings
// link, what the file holds and leaves out, the wait, the download, and the refusal of a second ask.

test("an export: asked for in settings, built by a job, downloaded as a ZIP", async ({
  browser,
}) => {
  test.slow();
  const a = await person(browser, "Auður Prófsdóttir");
  await a.setViewportSize({ width: 320, height: 700 });

  await a.goto(`${WEB}/settings`);
  await a.getByRole("link", { name: strings.export_title, exact: true }).click();
  await expect(a.getByRole("heading", { level: 1, name: strings.export_title })).toBeVisible();
  await expect(a.getByText(strings.export_left_out)).toBeVisible();
  await expect(a.getByText(strings.export_anonymous_warning)).toBeVisible();
  expect(await pageOverflow(a)).toBe(0);

  await a.getByRole("button", { name: strings.export_start, exact: true }).click();
  await expect(a.getByText(strings.export_building)).toBeVisible();
  await expect(async () => {
    await runJobs();
    await a.reload();
    await expect(a.getByRole("button", { name: strings.export_download })).toBeVisible({
      timeout: 2000,
    });
  }).toPass();

  const saved = a.waitForEvent("download");
  await a.getByRole("button", { name: strings.export_download }).click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe("export.zip");
  const bytes = await readFile(await file.path());
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
  expect(bytes.includes("export.json")).toBe(true);
  // Asking again within a day is not offered: the ready file is shown instead.
  await expect(a.getByRole("button", { name: strings.export_start })).toHaveCount(0);
});
