import type { ItemClass } from "../../api/imports.ts";
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
  /** Paths of the person's own image entries in the ZIP, from its root. */
  images: string[];
  hasVideo: boolean;
  class: ItemClass;
  /** Someone else's images on this post, which stay out while its words come in. */
  foreignImages: number;
  /** Its text only names the images, so it does not arrive without them. */
  needsImages: boolean;
};

/** What became no post, and why. */
export type DropReason = "videoOnly" | "foreignOnly" | "empty";

/** What the rest of the export says about its posts (decision 0127). */
export type ExportContext = {
  /** Paths of the media the person's own albums and lists hold. */
  ownMedia: ReadonlySet<string>;
  /** The timestamps, in seconds, of what they wrote on someone else's timeline. */
  otherTimelines: ReadonlySet<number>;
  /** The timestamps, in seconds, of what they archived, by its text. */
  archived: ReadonlyMap<string, readonly number[]>;
};

export const IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i;
export const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
/** The whole text of an imported post; a row in D1 and a post both stay far under this. */
export const MAX_BODY = 100_000;
/** How close an archived text's date is to its post's, in seconds: the two are written apart. */
const ARCHIVE_WINDOW = 2 * 24 * 60 * 60;
/** A line that is nothing but one address. */
const BARE_URL = /^\w+:\/\/\S+$/;

export const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The file's list: the file itself, or the first list inside its one wrapping object. */
export const listOf = (json: unknown): unknown[] => {
  if (Array.isArray(json)) return json;
  const inner = Object.values(record(json) ?? {}).find(Array.isArray);
  return (inner as unknown[] | undefined) ?? [];
};

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
export const zipPath = (uri: string) => uri.replace(/^(\.?\/)+/, "");

export async function idOf(at: number, text: string, firstMedia: string): Promise<string> {
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

type Attached = {
  uris: string[];
  images: string[];
  links: string[];
  captions: string[];
  hasVideo: boolean;
  foreign: boolean;
  foreignImages: number;
};

/** The ZIP path a media item points at, or null. */
const uriOf = (item: unknown) => {
  const uri = record(record(item)?.["media"])?.["uri"];
  return typeof uri === "string" ? zipPath(uri) : null;
};

const linkOf = (item: unknown) => {
  const url = textOf(record(record(item)?.["external_context"])?.["url"]);
  return url === "" ? null : url;
};

/** The words written on a media item. */
const captionOf = (item: unknown) =>
  textOf(record(record(item)?.["media"])?.["description"])?.trim() ?? "";

/** One media item, added to what a post points at; only the person's own image comes. */
function addMedia(found: Attached, uri: string, item: unknown, own: ReadonlySet<string>): void {
  const mine = own.has(uri);
  found.uris.push(uri);
  if (!mine) found.foreign = true;
  if (VIDEO.test(uri)) found.hasVideo = true;
  else if (IMAGE.test(uri) && !mine) found.foreignImages += 1;
  else if (IMAGE.test(uri) && !found.images.includes(uri)) found.images.push(uri);
  const caption = mine ? captionOf(item) : "";
  if (caption !== "") found.captions.push(caption);
}

/** What the attachments of a post point at: media in the ZIP and links. */
function attachedOf(attachments: unknown[], own: ReadonlySet<string>): Attached {
  const found: Attached = {
    uris: [],
    images: [],
    links: [],
    captions: [],
    hasVideo: false,
    foreign: false,
    foreignImages: 0,
  };
  for (const attachment of attachments) {
    const inner = record(attachment)?.["data"];
    if (!Array.isArray(inner)) continue;
    for (const item of inner) {
      const uri = uriOf(item);
      if (uri !== null) addMedia(found, uri, item, own);
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

/** The post's text with the captions its text does not already hold. */
const withCaptions = (text: string, captions: string[]) =>
  captions.reduce(
    (words, caption) =>
      words.includes(caption) ? words : `${words}${words === "" ? "" : "\n\n"}${caption}`,
    text,
  );

/** Whether the words say nothing beyond the addresses the post points at. */
const onlyLinks = (words: string, links: string[]) =>
  words.split("\n").every((raw) => {
    const line = raw.trim();
    return line === "" || links.includes(line) || BARE_URL.test(line);
  });

const isArchived = (text: string, seconds: number, context: ExportContext) =>
  (context.archived.get(text.trim()) ?? []).some(
    (date) => Math.abs(date - seconds) < ARCHIVE_WINDOW,
  );

/** Why an entry with nothing of the person's own to say becomes no post, if it does. */
function noPost(words: string, { images, links, hasVideo, foreign }: Attached): DropReason | null {
  if (words !== "") return null;
  if (foreign) return "foreignOnly";
  if (images.length > 0) return null;
  if (hasVideo) return "videoOnly";
  return links.length === 0 ? "empty" : null;
}

/** What an entry is, or why it becomes no post. The order is decision 0127's. */
function classify(
  text: string,
  words: string,
  seconds: number,
  attached: Attached,
  context: ExportContext,
): ItemClass | DropReason {
  const { uris, images, links } = attached;
  const carries = words !== "" || links.length > 0 || images.length > 0;
  if (uris.length === 0 && !carries) return "empty";
  if (text !== "" && isArchived(text, seconds, context)) return "hidden";
  if (carries && context.otherTimelines.has(seconds)) return "other_timeline";
  return (
    noPost(words, attached) ?? (images.length === 0 && onlyLinks(words, links) ? "link" : "own")
  );
}

type Parsed = ParsedItem | { id: string; why: DropReason };

async function parseEntry(raw: unknown, context: ExportContext): Promise<Parsed | null> {
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
  const attached = attachedOf(attachments, context.ownMedia);
  const words = withCaptions(text, attached.captions);
  const id = await idOf(at, text, attached.uris[0] ?? "");
  const kind = classify(text, words, seconds, attached, context);
  if (kind === "videoOnly" || kind === "foreignOnly" || kind === "empty") return { id, why: kind };
  return {
    id,
    at,
    body: withLinks(words, attached.links).slice(0, MAX_BODY),
    needsImages: false,
    images: attached.images,
    hasVideo: attached.hasVideo,
    class: kind,
    foreignImages: attached.foreignImages,
  };
}

/** The posts of one parsed file, what became no post, and how many entries were skipped. */
export async function parseExportFile(
  json: unknown,
  context: ExportContext,
): Promise<{ items: ParsedItem[]; dropped: { id: string; why: DropReason }[]; skipped: number }> {
  const dropped: { id: string; why: DropReason }[] = [];
  if (!Array.isArray(json)) return { items: [], dropped, skipped: 1 };
  const items: ParsedItem[] = [];
  let skipped = 0;
  for (const raw of json) {
    const parsed = await parseEntry(raw, context).catch(() => null);
    if (parsed === null) skipped++;
    else if ("why" in parsed) dropped.push(parsed);
    else items.push(parsed);
  }
  return { items, dropped, skipped };
}
