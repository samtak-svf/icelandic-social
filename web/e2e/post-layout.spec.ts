import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { found, person, post, write } from "./social-helpers.ts";
import { expect, test } from "./origin.ts";

// The post page on a phone, measured rather than looked at (2026-10-26, on a phone): a long
// verified name keeps its mark on its last line, the back bar sits under the header, the
// comments start close under the post, and the comment box holds no empty line.

const NAME = "Anna Margrét Sigurbjörnsdóttir Kristjánsdóttir";

/** Where things sit, in CSS pixels from the top of the page. */
async function measure(page: Page) {
  return page.evaluate((name) => {
    const box = (el: Element | null) => {
      if (el === null) throw new Error("missing element");
      const r = el.getBoundingClientRect();
      return { top: r.top + scrollY, bottom: r.bottom + scrollY, height: r.height };
    };
    const article = document.querySelector("main article");
    if (article === null) throw new Error("no post");
    // Read from the text and the mark, not the markup, so the check runs on any version.
    const words = name.split(" ");
    const texts: Text[] = [];
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node instanceof Text) texts.push(node);
    }
    const lines = (word: string) => {
      const text = texts.find((t) => t.data.includes(word));
      if (text === undefined) throw new Error(`no ${word}`);
      const range = document.createRange();
      range.selectNodeContents(text);
      return [...range.getClientRects()];
    };
    const first = lines(words[0] ?? "")[0];
    const last = lines(words.at(-1) ?? "").at(-1);
    const mark = article.querySelector(".text-verified-mark");
    if (first === undefined || last === undefined || mark === null) throw new Error("no mark");
    const mid = (r: DOMRect) => (r.top + r.bottom) / 2;
    const composer = document.querySelector("[data-comment-composer]");
    return {
      nameHeight: last.bottom - first.top,
      markOffLine: Math.abs(mid(last) - mid(mark.getBoundingClientRect())),
      header: box(document.querySelector("header")),
      backBar: box(document.querySelector("main > .sticky")),
      article: box(article),
      comments: box(document.querySelector("main section")),
      composer: box(composer),
      field: box(composer?.querySelector("textarea") ?? null),
    };
  }, NAME);
}

test("a long verified name keeps its mark, and the post page wastes no space", async ({
  browser,
}) => {
  const owner = await person(browser, NAME);
  await found(owner, "open");
  await write(owner, strings.post_compose, strings.post_publish, "Norðurljósin í gær.");
  await post(owner, "Norðurljósin í gær.")
    .getByRole("link", { name: strings.post_comment_action, exact: true })
    .click();
  await expect(owner.getByPlaceholder(strings.post_write_comment)).toBeVisible();

  // Whether the mark is pushed alone onto a line depends on where the name breaks, so
  // every phone width is tried: the mark stays on the line of the name's last word.
  const offLine: number[] = [];
  for (let width = 300; width <= 430; width += 2) {
    await owner.setViewportSize({ width, height: 844 });
    if ((await measure(owner)).markOffLine >= 6) offLine.push(width);
  }
  expect.soft(offLine).toEqual([]);

  await owner.setViewportSize({ width: 390, height: 844 });
  const m = await measure(owner);
  // The name wraps at this width.
  expect.soft(m.nameHeight).toBeGreaterThan(30);
  // The back bar starts where the header ends.
  expect.soft(Math.abs(m.backBar.top - m.header.bottom)).toBeLessThan(2);
  // The comments start at most 12 px under the post card.
  expect.soft(m.comments.top - m.article.bottom).toBeLessThanOrEqual(12);
  // The box is its field and padding: no empty status line under the field.
  expect.soft(m.composer.bottom - m.field.bottom).toBeLessThanOrEqual(10);
});
