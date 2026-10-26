import { describe, expect, it } from "vitest";
import { relative, relativeTime } from "./relative-time.ts";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const ago = (ms: number) => NOW - ms;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relative", () => {
  it("is now below a minute, and for a clock that runs ahead", () => {
    expect(relative(ago(0), NOW)).toEqual({ unit: "now" });
    expect(relative(ago(59_999), NOW)).toEqual({ unit: "now" });
    expect(relative(NOW + 5 * MIN, NOW)).toEqual({ unit: "now" });
  });

  it("counts whole minutes, hours, days and weeks, rounding down", () => {
    expect(relative(ago(MIN), NOW)).toEqual({ unit: "minutes", count: 1 });
    expect(relative(ago(59 * MIN + 59_000), NOW)).toEqual({ unit: "minutes", count: 59 });
    expect(relative(ago(HOUR), NOW)).toEqual({ unit: "hours", count: 1 });
    expect(relative(ago(6 * HOUR + 40 * MIN), NOW)).toEqual({ unit: "hours", count: 6 });
    expect(relative(ago(DAY), NOW)).toEqual({ unit: "days", count: 1 });
    expect(relative(ago(6 * DAY + 23 * HOUR), NOW)).toEqual({ unit: "days", count: 6 });
    expect(relative(ago(7 * DAY), NOW)).toEqual({ unit: "weeks", count: 1 });
    expect(relative(ago(27 * DAY), NOW)).toEqual({ unit: "weeks", count: 3 });
  });

  it("gives up on units after four weeks", () => {
    expect(relative(ago(28 * DAY), NOW)).toEqual({ unit: "date" });
  });
});

describe("relativeTime", () => {
  it("writes the short Icelandic labels", () => {
    expect(relativeTime(ago(10_000), NOW)).toBe("Núna");
    expect(relativeTime(ago(5 * MIN), NOW)).toBe("5 mín.");
    expect(relativeTime(ago(6 * HOUR), NOW)).toBe("6 klst.");
    expect(relativeTime(ago(2 * DAY), NOW)).toBe("2 d.");
    expect(relativeTime(ago(14 * DAY), NOW)).toBe("2 vik.");
  });

  it("writes the date once it is old", () => {
    expect(relativeTime(Date.UTC(2026, 6, 4, 12), NOW)).toBe("4. júl. 2026");
  });
});
