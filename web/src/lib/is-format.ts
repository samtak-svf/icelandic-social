// Icelandic dates without Intl. Desktop Chrome and Edge, and Cloudflare
// Workers, ship no Icelandic date data, so Intl date formatting for "is" renders
// English there (#357). Copied from cldr-is's src/format.ts, the two shapes
// the web uses, and pinned against Node's full ICU in is-format.test.ts.
//
// Both read the viewer's LOCAL fields, as Intl with no timeZone does: for a
// reader in Iceland that is UTC, for anyone else their own clock.

const IS_MONTHS = [
  "janúar",
  "febrúar",
  "mars",
  "apríl",
  "maí",
  "júní",
  "júlí",
  "ágúst",
  "september",
  "október",
  "nóvember",
  "desember",
];

// CLDR's abbreviated set: the periods where CLDR puts them, none on "maí".
const IS_MONTHS_SHORT = [
  "jan.",
  "feb.",
  "mar.",
  "apr.",
  "maí",
  "jún.",
  "júl.",
  "ágú.",
  "sep.",
  "okt.",
  "nóv.",
  "des.",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026-10" (the month an account joined) as "október 2026". */
export function formatIsMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  const name = number === undefined ? undefined : IS_MONTHS[number - 1];
  return year === undefined || name === undefined ? month : `${name} ${year}`;
}

/** "2. september 2026": the { dateStyle: "long" } shape. */
export function formatIsDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}. ${IS_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2. sep. 2026": the { dateStyle: "medium" } shape, the short date the apps show with a year. */
export function formatIsDateShort(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}. ${IS_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2. sep. 2026, 12:07": the { dateStyle: "medium", timeStyle: "short" } shape. */
export function formatIsDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}. ${IS_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// CLDR's abbreviated weekdays, Sunday first as Date.getDay() counts.
const IS_WEEKDAYS_SHORT = ["sun.", "mán.", "þri.", "mið.", "fim.", "fös.", "lau."];

const DAY_MS = 86_400_000;

/** Midnight of a moment's local day, as a day number that ignores DST shifts. */
const dayNumber = (d: Date) =>
  Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);

/**
 * A conversation row's stamp, as the apps show it (Android's Dates.stamp): the
 * time today (or later, a clock a little behind), `yesterday` in lower case,
 * the short weekday within the week, the day and month this year, else with
 * the year. The final period goes, as the row is short; a period inside stays.
 */
export function listStamp(at: number, now: number, yesterday: string): string {
  const d = new Date(at);
  const today = new Date(now);
  const back = dayNumber(today) - dayNumber(d);
  if (back <= 0) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (back === 1) return yesterday.toLowerCase();
  if (back < 7) return (IS_WEEKDAYS_SHORT[d.getDay()] ?? "").replace(/\.$/, "");
  const month = IS_MONTHS_SHORT[d.getMonth()] ?? "";
  if (d.getFullYear() === today.getFullYear()) return `${d.getDate()}. ${month.replace(/\.$/, "")}`;
  return `${d.getDate()}. ${month} ${d.getFullYear()}`;
}
