import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { jobHandlers } from "../../../src/modules/imports/index.ts";
import { runJobs } from "../../../src/modules/jobs/index.ts";
import { worker } from "../../main.ts";
import { png } from "../../images.ts";
import { ok, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import type { WallPost } from "../social/wall-support.ts";
import { buildZip, type FixtureEntry } from "./zip-fixture.ts";

// An export file taken through the routes as a person would, for the tests of what comes in.

export const E = euEnv(env);
export const BASE = "https://spjall.test";
export const MAY_2019 = Date.UTC(2019, 4, 17, 12, 30, 45);

export type Status = {
  state: string;
  failure: string | null;
  counts: { posts: number; images: number; videos: number; skipped: number };
  classes: {
    class: string;
    posts: number;
    images: number;
    imagesLost: number;
    videos: number;
  }[];
  lost: {
    videoOnly: number;
    foreignOnly: number;
    foreignImages: number;
    empty: number;
    videoFiles: number;
    videoBytes: number;
  };
  held: { posts: number; groups: { class: string; year: number; posts: number }[] };
};
export type Item = {
  id: string;
  at: number;
  text: string;
  images: number;
  hasVideo: boolean;
  class: string;
};
export type Read = WallPost & { createdAt: number; imported?: boolean; media: unknown[] };

/** How the export writes text: each UTF-8 byte as one Latin-1 code point. */
const escaped = (text: string) => String.fromCharCode(...new TextEncoder().encode(text));
export const utf8 = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

export const entry = (seconds: number, text: string, extra: object = {}) => ({
  timestamp: seconds,
  data: [{ post: escaped(text) }],
  ...extra,
});
export const media = (...uris: string[]) => ({
  attachments: [{ data: uris.map((uri) => ({ media: { uri } })) }],
});

export const postsFile = (entries: unknown[], name = "your_posts_1.json"): FixtureEntry => ({
  name: `posts/${name}`,
  data: utf8(entries),
  method: "deflate",
});

export async function drain(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const { done } = await runJobs(E, jobHandlers(), Date.now() + 1);
    if (done === 0) return;
  }
  throw new Error("the jobs did not finish");
}

export const get = async <T>(owner: Person, path: string) => ok<T>(await owner.call("GET", path));

/** Uploads `zip` as `owner` in one part, completes it, and runs the parse. */
export async function upload(owner: Person, zip: Uint8Array): Promise<string> {
  const started = await owner.call("POST", "/v1/imports/file", { size: zip.length });
  expect(started.status).toBe(201);
  const { importId } = (await started.json()) as { importId: string };
  const put = await worker.fetch(`${BASE}/v1/imports/${importId}/parts/1`, {
    method: "PUT",
    headers: { ...owner.auth, "content-type": "application/octet-stream" },
    body: zip,
  });
  expect(put.status).toBe(204);
  expect((await owner.call("POST", `/v1/imports/${importId}/complete`)).status).toBe(204);
  await drain();
  return importId;
}

export const status = (owner: Person, importId: string) =>
  get<Status>(owner, `/v1/imports/${importId}`);
export const items = async (owner: Person, importId: string) =>
  (await get<{ items: Item[] }>(owner, `/v1/imports/${importId}/items`)).items;

/** Brings the chosen posts in, where they are held. */
export async function publish(owner: Person, importId: string, choice: object = {}) {
  const response = await owner.call("POST", `/v1/imports/${importId}/publish`, choice);
  expect(response.status).toBe(204);
  await drain();
}

/** Opens what the import holds, as the person would; how many. */
export async function open(owner: Person, importId: string, choice: object = {}) {
  const response = await owner.call("POST", `/v1/imports/${importId}/open`, {
    audience: "friends",
    ...choice,
  });
  return (await ok<{ opened: number }>(response)).opened;
}

/** Brings the chosen posts in and opens them to friends. */
export async function arrive(owner: Person, importId: string, choice: object = {}) {
  await publish(owner, importId, choice);
  await open(owner, importId);
}

/** One page of 50, which holds every post these tests bring in. */
export const wall = async (reader: Person, owner: Person) =>
  (await get<{ posts: Read[] }>(reader, `/v1/accounts/${owner.accountId}/wall/posts?limit=50`))
    .posts;

/** A photo as an album lists it. */
export const photo = (uri: string, seconds: number, description?: string) => ({
  uri,
  creation_timestamp: seconds,
  ...(description === undefined ? {} : { description: escaped(description) }),
});
export const namedAlbum = (
  index: number,
  name: string,
  photos: unknown[],
  description = "",
): FixtureEntry => ({
  name: `posts/album/${index}.json`,
  data: utf8({ name: escaped(name), description: escaped(description), photos }),
});

/** The person's own album, which says whose the media beside the posts are. */
export const album = (...uris: string[]): FixtureEntry => ({
  name: "posts/album/0.json",
  data: utf8({ photos: uris.map((uri) => ({ uri })) }),
});
export const OWN_MEDIA = album("posts/media/a.png", "posts/media/b.png", "posts/media/c.mp4");

export const SAMPLE = [
  entry(MAY_2019 / 1000, "Fyrsta færsla með þ, ð, æ, ö"),
  entry(MAY_2019 / 1000 + 60, "Með mynd 😀", media("posts/media/a.png", "posts/media/b.png")),
  entry(MAY_2019 / 1000 + 120, "Með myndbandi", media("posts/media/c.mp4")),
];

export async function sampleZip(entries: unknown[] = SAMPLE) {
  const image = await png(8, 8);
  return buildZip([
    postsFile(entries),
    OWN_MEDIA,
    { name: "posts/media/a.png", data: image },
    { name: "posts/media/b.png", data: image, method: "deflate" },
    { name: "posts/media/c.mp4", data: new Uint8Array([1, 2, 3]) },
  ]);
}
