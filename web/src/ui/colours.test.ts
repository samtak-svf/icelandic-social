import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { compile } from "tailwindcss";
import { expect, test } from "vitest";

// The brand theme clears Tailwind's palette (`--color-*: initial`), so a colour
// class that names no token, such as `bg-white`, builds to nothing and fails
// silently: the QR lost its light background in dark mode. Every colour class
// the web uses is compiled against the real stylesheet and must produce a rule.

const src = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(src, "styles.css"));

async function stylesheet() {
  return compile(await readFile(path.join(src, "styles.css"), "utf8"), {
    base: src,
    async loadStylesheet(id: string, base: string) {
      const file =
        id === "tailwindcss" ? require.resolve("tailwindcss/index.css") : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: await readFile(file, "utf8") };
    },
  });
}

/** Utilities that take a colour, with an optional variant prefix and opacity. */
const COLOUR =
  /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border(?:-[trblxy])?|fill|stroke|ring|outline|divide|decoration|accent|caret|placeholder)-[a-z][a-z-]*(?:\/\d+)?(?![\w-])/g;

/** Sizes, sides and keywords that share a colour utility's prefix. */
const NOT_A_COLOUR =
  /^(?:text-(?:xs|sm|base|lg|[2-9]?xl|left|center|right|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)|border-(?:solid|dashed|dotted|none|collapse|separate)|outline-(?:none|hidden|offset-.*|solid|dashed)|fill-none|stroke-none|ring-inset|divide-[xy])$/;

async function tsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx"))
    .map((e) => path.join(e.parentPath, e.name));
}

test("every colour class the web uses builds to a rule", async () => {
  const css = await stylesheet();
  const used = new Set<string>();
  for (const file of await tsxFiles(src)) {
    for (const [m] of (await readFile(file, "utf8")).matchAll(COLOUR)) {
      const utility = m.split(":").at(-1) ?? m;
      if (!NOT_A_COLOUR.test(utility.replace(/\/\d+$/, ""))) used.add(m);
    }
  }
  expect(used.size).toBeGreaterThan(10);
  // `build` keeps every candidate it has seen, so a class that adds nothing leaves the output as it was.
  const empty = [...used].filter((name) => css.build([]).length === css.build([name]).length);
  expect(empty).toEqual([]);
});
