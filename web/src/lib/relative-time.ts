import { strings } from "../generated/brand/strings.ts";
import { formatIsDateShort } from "./is-format.ts";

// The short age a post card carries ("6 klst."), decision 0080. The step is
// pure so it is tested without a clock; the label puts the brand's words on it.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export type Relative =
  | { unit: "now" }
  | { unit: "minutes" | "hours" | "days" | "weeks"; count: number }
  | { unit: "date" };

/** How long before `now` the moment `at` was: whole units, rounded down, "date" after four weeks. */
export function relative(at: number, now: number): Relative {
  // A clock a little ahead of the server's must not read as the future.
  const age = Math.max(0, now - at);
  if (age < MINUTE) return { unit: "now" };
  if (age < HOUR) return { unit: "minutes", count: Math.floor(age / MINUTE) };
  if (age < DAY) return { unit: "hours", count: Math.floor(age / HOUR) };
  if (age < WEEK) return { unit: "days", count: Math.floor(age / DAY) };
  if (age < 4 * WEEK) return { unit: "weeks", count: Math.floor(age / WEEK) };
  return { unit: "date" };
}

/** The label of `relative`, or the date itself once it is no longer recent. */
export function relativeTime(at: number, now: number = Date.now()): string {
  const r = relative(at, now);
  if (r.unit === "now") return strings.time_now;
  if (r.unit === "date") return formatIsDateShort(at);
  const args = { count: r.count };
  if (r.unit === "minutes") return strings.time_minutes(args);
  if (r.unit === "hours") return strings.time_hours(args);
  if (r.unit === "days") return strings.time_days(args);
  return strings.time_weeks(args);
}
