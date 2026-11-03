import { LIMITS } from "../../limits.gen.ts";

// Fetching what a transferred post links to (decision 0129). The address comes from the
// exporter, so it is treated as anyone's: https only, a public host name and never an
// address literal, redirects followed by hand and checked the same way, a time limit,
// and no more bytes than an image may have. A failure is an empty answer, which the
// upload then counts as an image left out.

const REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const LOCAL = /(^|\.)(localhost|local|internal|localdomain|home|lan|arpa|test|invalid)$/i;

/** Whether `url` may be fetched: https, a named public host, the standard port. */
export function fetchable(url: URL): boolean {
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  if (url.port !== "" && url.port !== "443") return false;
  // A name may end in the root dot, which names the same host: `localhost.` is `localhost`.
  const host = url.hostname.replace(/\.$/, "");
  // An IPv6 literal is bracketed, and an IPv4 one is all digits and dots.
  if (host.startsWith("[") || /^[\d.]+$/.test(host) || /^0x/i.test(host)) return false;
  return host.includes(".") && !LOCAL.test(host);
}

/** One request: where it redirects to, or its bytes (empty when refused or too large). */
async function hop(url: URL, cap: number, signal: AbortSignal): Promise<URL | Uint8Array> {
  if (!fetchable(url)) return new Uint8Array();
  const response = await fetch(url, { redirect: "manual", signal });
  const location = response.headers.get("location");
  const redirected = response.status >= 300 && response.status < 400 && location;
  const tooLarge = Number(response.headers.get("content-length") ?? 0) > cap;
  if (redirected || !response.ok || !response.body || tooLarge) {
    await response.body?.cancel();
    return redirected ? new URL(location, url) : new Uint8Array();
  }
  return (await capped(response.body, cap)) ?? new Uint8Array();
}

/** The bytes at `address`, at most `cap` of them, or an empty array. */
export async function fetchBytes(
  address: string,
  cap: number = LIMITS.imageBytes,
): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return new Uint8Array();
  }
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    // Each redirect is checked again before it is followed.
    for (let n = 0; n <= REDIRECTS; n++) {
      const next = await hop(url, cap, signal);
      if (next instanceof Uint8Array) return next;
      url = next;
    }
  } catch {
    // A refused, timed-out or broken fetch is an image left out.
  }
  return new Uint8Array();
}

/** The stream's bytes, or null once they pass `cap`. */
export async function capped(
  stream: ReadableStream<Uint8Array>,
  cap: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}
