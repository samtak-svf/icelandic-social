import { z } from "zod";
import type { SourcePost } from "../imports/index.ts";
import { fetchBytes, fetchable } from "./fetch.ts";

// The items an exporter sends (decision 0129), as the Data Transfer Initiative's generic
// importer schemas describe them: each wrapped in a GenericPayload, a social post as an
// activity, an album and a photo as media. Only what a post here can hold is read, and
// fields this destination does not know are ignored, so a newer exporter still fits.

const text = z.string().max(200_000).nullish();

const Attachment = z.object({
  type: z.string().nullish(),
  url: text,
  name: text,
  content: text,
});

const Activity = z.object({
  activity: z.object({
    id: z.string().min(1).max(500),
    content: z.string().max(200_000),
    published: z.union([z.string().max(64), z.number()]).nullish(),
    type: z.string().nullish(),
    title: text,
    url: text,
    location: z.object({ name: text }).nullish(),
    attachments: z.array(Attachment).max(100).nullish(),
  }),
});

const Album = z.object({
  "@type": z.literal("Album"),
  id: z.string().min(1).max(500),
  name: text,
  description: text,
});

const File = z.object({
  "@type": z.enum(["Photo", "Video"]),
  name: text,
  description: text,
  albumId: z.string().max(500).nullish(),
  uploadedTime: z.union([z.string().max(64), z.number()]).nullish(),
});

/** The payload inside a GenericPayload wrapper, or the value itself when it has none. */
function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "payload" in value) return value.payload;
  return value;
}

/**
 * A time as an exporter writes it: an ISO date-time, or seconds since the epoch as a
 * number or a string of digits (milliseconds when it is that large). Milliseconds, or
 * null when it is none of them.
 */
function timeOf(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number =
    typeof value === "number" ? value : /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
  if (number !== null) {
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.round(number > 1e11 ? number : number * 1000);
  }
  const parsed = Date.parse(value as string);
  return Number.isNaN(parsed) ? null : parsed;
}

const clean = (value: string | null | undefined) => (value ?? "").trim();

type ActivityItem = z.infer<typeof Activity>["activity"];

/** The post's text: its title unless the content opens with it, the place, then its links. */
function textOf(activity: ActivityItem): string {
  const content = clean(activity.content);
  const title = clean(activity.title);
  const parts = [title !== "" && !content.startsWith(title) ? title : "", content];
  if (activity.type === "CHECKIN") parts.push(clean(activity.location?.name));
  // A link is kept as its address in the text, where the reader can follow it.
  for (const link of (activity.attachments ?? []).filter((a) => a.type === "LINK")) {
    const address = clean(link.url);
    if (address !== "" && !content.includes(address)) parts.push(address);
  }
  return parts.filter((part) => part !== "").join("\n\n");
}

/** A video does not come over (decision 0120); the original's address is kept for it. */
function videoLinkOf(activity: ActivityItem): string | undefined {
  const video = activity.attachments?.find((a) => a.type === "VIDEO");
  if (!video) return undefined;
  const original = clean(activity.url) || clean(video.url);
  try {
    return original !== "" && fetchable(new URL(original)) ? original : undefined;
  } catch {
    return undefined;
  }
}

/** A social post as the core takes it, or null when it is not one. */
export function postOf(json: unknown, now = Date.now()): SourcePost | null {
  const parsed = Activity.safeParse(unwrap(json));
  if (!parsed.success) return null;
  const { activity } = parsed.data;
  const images = (activity.attachments ?? [])
    .filter((a) => a.type === "IMAGE" && clean(a.url) !== "")
    .map((a) => () => fetchBytes(clean(a.url)));
  return {
    id: `dtp:${activity.id}`,
    createdAt: timeOf(activity.published) ?? now,
    body: textOf(activity),
    images,
    link: videoLinkOf(activity),
    class: "own",
  };
}

export type AlbumItem = { albumId: string; name: string; description: string };

/** An album, or null when the item is not one. */
export function albumOf(json: unknown): AlbumItem | null {
  const parsed = Album.safeParse(unwrap(json));
  if (!parsed.success) return null;
  const { id, name, description } = parsed.data;
  return { albumId: id, name: clean(name), description: clean(description) };
}

export type FileItem = {
  kind: "Photo" | "Video";
  albumId: string | null;
  takenAt: number | null;
  caption: string;
};

/** What a file item says of its file, or null when it says nothing readable. */
export function fileOf(json: unknown): FileItem | null {
  const parsed = File.safeParse(unwrap(json));
  if (!parsed.success) return null;
  const item = parsed.data;
  return {
    kind: item["@type"],
    albumId: item.albumId ?? null,
    takenAt: timeOf(item.uploadedTime),
    caption: clean(item.description),
  };
}
