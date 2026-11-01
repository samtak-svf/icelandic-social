import { mediaBucket } from "../../env/index.ts";
import type { DirectoryEntry } from "./zip-writer.ts";

// A build's whole state in one R2 object (decision 0126): four bytes of JSON length,
// the JSON, then the bytes not yet sent as a part. One put writes both, so the two
// cannot disagree.

/** Where the walk of the person's content stands. */
export type Cursor = {
  step: "profile" | "photo" | "friends" | "spaces" | "space" | "finish";
  /** The spaces to walk, by id, once listed. */
  spaces: { spaceId: string; kind: "wall" | "community" | "unavailable"; name: string | null }[];
  /** Index into `spaces`. */
  space: number;
  stage: "meta" | "posts" | "comments" | "reactions" | "comment_reactions" | "votes";
  /** The last row of the stage's keyset, or null at its start. */
  after: string | null;
  /** The next file number of each kind in the current space. */
  files: { posts: number; comments: number; reactions: number };
  /** Images of the page just written, still to copy in. */
  queue: { spaceId: string; mediaId: string }[];
  counts: Counts;
};

export type Counts = {
  posts: number;
  comments: number;
  reactions: number;
  images: number;
  spaces: number;
  friends: number;
  /** Images a moderator took down, or that are gone from storage. */
  images_withheld: number;
};

export type Checkpoint = {
  uploadId: string;
  /** The run whose job continues the build; a job for another run is stale. */
  run: number;
  parts: { partNumber: number; etag: string }[];
  /** Bytes in the parts, all of them the same length. */
  written: number;
  entries: DirectoryEntry[];
  cursor: Cursor;
};

export const checkpointKey = (exportId: string) => `exports/${exportId}.checkpoint`;
export const zipKey = (exportId: string) => `exports/${exportId}.zip`;

const emptyCounts = (): Counts => ({
  posts: 0,
  comments: 0,
  reactions: 0,
  images: 0,
  spaces: 0,
  friends: 0,
  images_withheld: 0,
});

export const firstCursor = (): Cursor => ({
  step: "profile",
  spaces: [],
  space: 0,
  stage: "meta",
  after: null,
  files: { posts: 1, comments: 1, reactions: 1 },
  queue: [],
  counts: emptyCounts(),
});

export async function saveCheckpoint(
  env: Env,
  exportId: string,
  checkpoint: Checkpoint,
  tail: Uint8Array,
): Promise<void> {
  const json = new TextEncoder().encode(JSON.stringify(checkpoint));
  const out = new Uint8Array(4 + json.length + tail.length);
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  out.set(tail, 4 + json.length);
  await mediaBucket(env).put(checkpointKey(exportId), out);
}

export async function loadCheckpoint(
  env: Env,
  exportId: string,
): Promise<{ checkpoint: Checkpoint; tail: Uint8Array } | null> {
  const object = await mediaBucket(env).get(checkpointKey(exportId));
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  const checkpoint = JSON.parse(
    new TextDecoder().decode(bytes.subarray(4, 4 + length)),
  ) as Checkpoint;
  return { checkpoint, tail: bytes.slice(4 + length) };
}
