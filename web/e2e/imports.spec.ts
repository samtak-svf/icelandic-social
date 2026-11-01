import { buildZip } from "../../backend/test/modules/imports/zip-fixture.ts";
import { strings } from "../src/generated/brand/strings.ts";
import { pageOverflow, person, post, runJobs } from "./social-helpers.ts";
import { expect, test, WEB } from "./origin.ts";

// Bringing posts in from an export file (decision 0119), through what a person
// sees: choosing the file, the choice of what to publish, the posts on the wall
// with their letters whole, and the whole import taken back.

/** How the export writes text: each UTF-8 byte as one Latin-1 code point. */
const escaped = (text: string) => String.fromCharCode(...new TextEncoder().encode(text));

const KEPT = "Þjóðhátíð á Þingvöllum, æðislegt veður";
const LEFT_OUT = "Óþarfi að birta þennan póst";

async function exportFile() {
  const entries = [
    { timestamp: 1_600_000_000, data: [{ post: escaped(KEPT) }] },
    { timestamp: 1_600_100_000, data: [{ post: escaped(LEFT_OUT) }] },
  ];
  const data = new TextEncoder().encode(JSON.stringify(entries));
  const zip = await buildZip([{ name: "posts/your_posts_1.json", data, method: "deflate" }]);
  return { name: "export.zip", mimeType: "application/zip", buffer: Buffer.from(zip) };
}

test("an export file: the choice, the wall, and taking it all back", async ({ browser }) => {
  test.slow();
  const a = await person(browser, "Auður Prófsdóttir");
  await a.setViewportSize({ width: 320, height: 700 });

  await a.goto(`${WEB}/settings`);
  await a.getByRole("link", { name: strings.imports_title, exact: true }).click();
  await expect(a.getByRole("heading", { level: 1, name: strings.imports_title })).toBeVisible();
  expect(await pageOverflow(a)).toBe(0);

  const choose = a.getByLabel(strings.imports_file_choose);
  await expect(choose).toBeEnabled();
  await choose.setInputFiles(await exportFile());
  await a.waitForURL(/\/imports\/[^/]+$/);
  const counts = strings.imports_class_counts({ posts: "2", images: "0" });
  await expect(async () => {
    await runJobs();
    await expect(a.getByText(counts, { exact: true })).toBeVisible({ timeout: 4000 });
  }).toPass();

  // Nothing is out before it is chosen.
  await expect(a.getByRole("listitem").filter({ hasText: KEPT })).toBeVisible();
  expect(await pageOverflow(a)).toBe(0);
  await a.goto(`${WEB}/me`);
  await expect(post(a, KEPT)).toHaveCount(0);
  await a.goBack();

  await a.getByRole("listitem").filter({ hasText: LEFT_OUT }).getByRole("checkbox").uncheck();
  await a.getByRole("button", { name: strings.imports_publish, exact: true }).click();
  await expect(async () => {
    await runJobs();
    await expect(a.getByText(strings.imports_done, { exact: true })).toBeVisible({ timeout: 4000 });
  }).toPass();

  // It came in held: nobody reads it, its author included, until it is opened.
  const preview = a.url();
  await a.goto(`${WEB}/me`);
  await expect(post(a, KEPT)).toHaveCount(0);
  await a.goto(preview);
  await expect(a.getByRole("radio", { name: strings.wall_audience_friends })).toBeChecked();
  await expect(a.getByRole("article").filter({ hasText: KEPT })).toBeVisible();
  await expect(a.getByRole("article").filter({ hasText: LEFT_OUT })).toHaveCount(0);
  expect(await pageOverflow(a)).toBe(0);
  a.once("dialog", (dialog) => void dialog.accept());
  await a
    .getByRole("button", { name: strings.imports_held_open({ count: 1 }), exact: true })
    .click();
  await expect(
    a.getByText(strings.imports_held_opened({ count: 1 }), { exact: true }),
  ).toBeVisible();

  await a.goto(`${WEB}/me`);
  await expect(post(a, KEPT)).toBeVisible();
  await expect(post(a, LEFT_OUT)).toHaveCount(0);

  await a.goto(preview);
  a.once("dialog", (dialog) => void dialog.accept());
  await a.getByRole("button", { name: strings.imports_remove, exact: true }).click();
  await a.waitForURL(/\/imports(\?.*)?$/);
  await expect(async () => {
    await runJobs();
    await a.goto(`${WEB}/me`);
    await expect(post(a, KEPT)).toHaveCount(0, { timeout: 2000 });
  }).toPass();
});
