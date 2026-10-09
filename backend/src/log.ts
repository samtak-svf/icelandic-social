// The Worker's only way to write a log line (decision 0008). A line is an
// event name plus fields from a fixed allow list: opaque ids, counts,
// durations and error codes. Anything else is dropped, and a string that does
// not look like an opaque id is redacted, so a name, a phone number or a
// message body cannot reach Workers Logs even through a cast.
// tooling/seam-guard.mjs refuses `console` everywhere else under backend/src.

type Fields = {
  accountId: string;
  deviceId: string;
  conversationId: string;
  postId: string;
  seq: number;
  epoch: number;
  count: number;
  status: number;
  durationMs: number;
  code: string;
  /** Which way a person signed in (decision 0033), never who. */
  provider: "kenni" | "google";
};

const ALLOWED: ReadonlySet<string> = new Set<keyof Fields>([
  "accountId",
  "deviceId",
  "conversationId",
  "postId",
  "seq",
  "epoch",
  "count",
  "status",
  "durationMs",
  "code",
  "provider",
]);
const EVENT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const OPAQUE = /^[A-Za-z0-9_:-]{1,128}$/;
// Ids carry letters; seven or more digits alone look like a phone number or a
// kennitala, and are redacted even under an allowed name.
const DIGITS = /^\d{7,}$/;

export function log(event: `${string}.${string}`, fields: Partial<Fields>): void {
  if (!EVENT.test(event)) throw new Error(`log event must be dotted.snake_case: ${event}`);
  const line: Record<string, string | number> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) line[key] = value;
    else if (typeof value === "string")
      line[key] = OPAQUE.test(value) && !DIGITS.test(value) ? value : "[redacted]";
  }
  console.log(JSON.stringify(line));
}
