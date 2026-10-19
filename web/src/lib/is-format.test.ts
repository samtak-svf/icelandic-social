import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatIsDate, formatIsDateTime } from "./is-format.ts";

// Node ships full ICU, so its Intl is what CLDR says; the browsers that lack
// Icelandic are why the web does not use it (#357).

const zones = ["UTC", "America/New_York", "Asia/Tokyo"];
// Every month, a day that rolls in some zone, and a leap day.
const moments = [
  ...Array.from({ length: 12 }, (_, m) => Date.UTC(2026, m, 5, 9, 7)),
  Date.UTC(2026, 11, 31, 23, 59),
  Date.UTC(2028, 1, 29, 0, 0),
];

describe("Icelandic dates", () => {
  const zone = process.env.TZ;
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  for (const timeZone of zones) {
    it(`match Node's ICU in ${timeZone}`, () => {
      process.env.TZ = timeZone;
      const long = new Intl.DateTimeFormat("is", { dateStyle: "long", timeZone });
      const medium = new Intl.DateTimeFormat("is", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      });
      for (const ms of moments) {
        expect(formatIsDate(ms)).toBe(long.format(ms));
        expect(formatIsDateTime(ms)).toBe(medium.format(ms));
      }
    });
  }

  it("are the only way the web formats a date or a number", () => {
    const root = join(import.meta.dirname, "..");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
      (f) => /\.tsx?$/.test(f) && !f.startsWith("generated") && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(10);
    const locale =
      /Intl\.(DateTimeFormat|NumberFormat|RelativeTimeFormat|ListFormat|Collator)\b|\.toLocale(Date|Time)?String\(/;
    const offenders = files.filter((f) => locale.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
