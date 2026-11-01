import { toHex } from "../../shared/bytes.ts";
// The posts file of an export (decision 0119), parsed tolerantly: one entry in a
// shape this does not know is skipped and counted, and never fails the file.

/** The source key every route that reads this platform's posts dedupes under. */
export const SOURCE_KEY = "platform-a";

/** The entry names that hold posts, by their last path segment. */
export const POSTS_FILE = /^your_posts.*\.json$/;

/** A post as the preview and the publish read it. */
export type ParsedItem = {
  id: string;
  /** Milliseconds since the epoch. */
  at: number;
  body: string;
  /** Paths of image entries in the ZIP, from its root. */
  images: string[];
  hasVideo: boolean;
};

const IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
/** A row in D1 and a post both stay far under this. */
const MAX_BODY = 100_000;
const MAX_IMAGES = 20;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * The export writes each UTF-8 byte as one Latin-1 code point. A string is repaired
 * only when all its code units fit a byte and those bytes are valid UTF-8; text that
 * was written correctly is not valid UTF-8 read that way, and is left alone.
 */
export function repairText(text: string): string {
  const bytes = new Uint8Array(text.length);
  let high = false;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit > 0xff) return text;
    if (unit > 0x7f) high = true;
    bytes[i] = unit;
  }
  if (!high) return text;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return text;
  }
}

const textOf = (value: unknown) => (typeof value === "string" ? repairText(value) : null);

/** A path inside the ZIP, from its root. */
const zipPath = (uri: string) => uri.replace(/^(\.?\/)+/, "");

async function idOf(at: number, text: string, firstMedia: string): Promise<string> {
  const data = new TextEncoder().encode(`${at}\n${text}\n${firstMedia}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

/** The text of a post's `data` parts, joined. */
function textsOf(data: unknown[]): string {
  const posts: string[] = [];
  for (const part of data) {
    const post = textOf(record(part)?.["post"]);
    if (post !== null && post.trim() !== "") posts.push(post);
  }
  return posts.join("\n");
}

type Attached = { uris: string[]; images: string[]; links: string[]; hasVideo: boolean };

/** The ZIP path a media item points at, or null. */
const uriOf = (item: unknown) => {
  const uri = record(record(item)?.["media"])?.["uri"];
  return typeof uri === "string" ? zipPath(uri) : null;
};

const linkOf = (item: unknown) => {
  const url = textOf(record(record(item)?.["external_context"])?.["url"]);
  return url === "" ? null : url;
};

/** What the attachments of a post point at: media in the ZIP and links. */
function attachedOf(attachments: unknown[]): Attached {
  const found: Attached = { uris: [], images: [], links: [], hasVideo: false };
  for (const attachment of attachments) {
    const inner = record(attachment)?.["data"];
    if (!Array.isArray(inner)) continue;
    for (const item of inner) {
      const uri = uriOf(item);
      if (uri !== null) {
        found.uris.push(uri);
        if (VIDEO.test(uri)) found.hasVideo = true;
        else if (IMAGE.test(uri) && !found.images.includes(uri)) found.images.push(uri);
      }
      const link = linkOf(item);
      if (link !== null) found.links.push(link);
    }
  }
  return found;
}

const withLinks = (text: string, links: string[]) =>
  links.reduce(
    (body, link) => (body.includes(link) ? body : `${body}${body === "" ? "" : "\n"}${link}`),
    text,
  );

async function parseEntry(raw: unknown): Promise<ParsedItem | null> {
  const entry = record(raw);
  const seconds = entry?.["timestamp"];
  if (!entry || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const at = Math.round(seconds) * 1000;
  const data = entry["data"] ?? [];
  const attachments = entry["attachments"] ?? [];
  if (!Array.isArray(data) || !Array.isArray(attachments)) return null;

  const text = textsOf(data);
  const { uris, images, links, hasVideo } = attachedOf(attachments);
  const body = withLinks(text, links);
  if (body === "" && images.length === 0 && !hasVideo) return null;
  return {
    id: await idOf(at, text, uris[0] ?? ""),
    at,
    body: body.slice(0, MAX_BODY),
    images: images.slice(0, MAX_IMAGES),
    hasVideo,
  };
}

/** The posts of one parsed file, and how many entries were skipped. */
export async function parseExportFile(
  json: unknown,
): Promise<{ items: ParsedItem[]; skipped: number }> {
  if (!Array.isArray(json)) return { items: [], skipped: 1 };
  const items: ParsedItem[] = [];
  let skipped = 0;
  for (const raw of json) {
    const item = await parseEntry(raw).catch(() => null);
    if (item) items.push(item);
    else skipped++;
  }
  return { items, skipped };
}
