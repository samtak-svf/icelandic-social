import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatIsDate, formatIsDateTime, listStamp } from "./is-format.ts";

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

describe("a conversation row's stamp", () => {
  const zone = process.env.TZ;
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });
  // Sunday 25 October 2026, 15:00 in Reykjavík (UTC).
  const now = Date.UTC(2026, 9, 25, 15, 0);
  const day = 24 * 3_600_000;

  it("is the time today, the word yesterday, the weekday within the week, else the date", () => {
    process.env.TZ = "UTC";
    expect(listStamp(Date.UTC(2026, 9, 25, 9, 7), now, "Í gær")).toBe("09:07");
    expect(listStamp(Date.UTC(2026, 9, 24, 23, 59), now, "Í gær")).toBe("í gær");
    expect(listStamp(now - 2 * day, now, "Í gær")).toBe("fös");
    expect(listStamp(now - 6 * day, now, "Í gær")).toBe("mán");
    expect(listStamp(now - 7 * day, now, "Í gær")).toBe("18. okt");
    expect(listStamp(Date.UTC(2026, 4, 3, 12), now, "Í gær")).toBe("3. maí");
    expect(listStamp(Date.UTC(2025, 7, 30, 12), now, "Í gær")).toBe("30. ágú. 2025");
    // A clock a little behind the sender's is still today.
    expect(listStamp(now + 60_000, now, "Í gær")).toBe("15:01");
  });

  it("names the weekdays and months as Node's ICU does, without the final period", () => {
    process.env.TZ = "UTC";
    const weekday = new Intl.DateTimeFormat("is", { weekday: "short", timeZone: "UTC" });
    const dayMonth = new Intl.DateTimeFormat("is", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    const dated = new Intl.DateTimeFormat("is", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    for (let back = 2; back < 7; back++) {
      const at = now - back * day;
      expect(listStamp(at, now, "Í gær")).toBe(weekday.format(at).replace(/\.$/, ""));
    }
    for (let m = 0; m < 12; m++) {
      const at = Date.UTC(2026, m, 5, 9);
      if (now - at < 7 * day) continue;
      expect(listStamp(at, now, "Í gær")).toBe(dayMonth.format(at).replace(/\.$/, ""));
      const older = Date.UTC(2024, m, 5, 9);
      expect(listStamp(older, now, "Í gær")).toBe(dated.format(older));
    }
  });
});
