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

/** "2. september 2026": the { dateStyle: "long" } shape. */
export function formatIsDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}. ${IS_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2. sep. 2026, 12:07": the { dateStyle: "medium", timeStyle: "short" } shape. */
export function formatIsDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}. ${IS_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
