import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAccount } from "../src/accounts.ts";
import { ApiError } from "../src/api/common.ts";
import { device, euEnv } from "./support.ts";
import { worker } from "./main.ts";

// The profile photo (decision 0039): re-encoded by the server to one 512 px
// WebP without metadata, kept in spjall-profiles by account id, shown to every
// signed-in account but across a block, and deleted with the account.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;
type Device = Awaited<ReturnType<typeof device>>;

// --- Images built in the test, so no fixture file holds one ---

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const ascii = (text: string) => new TextEncoder().encode(text);

function be32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = concat(ascii(type), data);
  return concat(be32(data.length), typed, be32(crc32(typed)));
}

/** An RGB PNG of `width` by `height`, a gradient so it is not one flat colour. */
async function png(width: number, height: number): Promise<Uint8Array> {
  const rows = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) rows.set([x % 256, y % 256, 128], row + 1 + x * 3);
  }
  const deflated = new Uint8Array(
    await new Response(
      new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const header = concat(be32(width), be32(height), Uint8Array.of(8, 2, 0, 0, 0));
  return concat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", header),
    chunk("IDAT", deflated),
    chunk("IEND", new Uint8Array()),
  );
}

/** A latitude no re-encoded photo should carry: 64° 8' 50.55" as rationals. */
const LATITUDE = [64, 1, 8, 1, 5055, 100];

/**
 * An EXIF APP1 segment, little-endian TIFF, whose IFD0 points at a GPS IFD
 * with GPSLatitudeRef "N" and GPSLatitude: where a phone photo was taken.
 */
function exifWithGps(): Uint8Array {
  const tiff = new Uint8Array(8 + 2 + 12 + 4 + 2 + 2 * 12 + 4 + LATITUDE.length * 4);
  const view = new DataView(tiff.buffer);
  tiff.set(ascii("II*\0"));
  view.setUint32(4, 8, true);
  // IFD0: one entry, GPSInfo (0x8825), LONG, the GPS IFD's offset.
  const gpsIfd = 8 + 2 + 12 + 4;
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8825, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, gpsIfd, true);
  view.setUint32(22, 0, true);
  // GPS IFD: GPSLatitudeRef (1), ASCII "N"; GPSLatitude (2), 3 RATIONALs.
  const rationals = gpsIfd + 2 + 2 * 12 + 4;
  view.setUint16(gpsIfd, 2, true);
  view.setUint16(gpsIfd + 2, 1, true);
  view.setUint16(gpsIfd + 4, 2, true);
  view.setUint32(gpsIfd + 6, 2, true);
  tiff.set(ascii("N\0"), gpsIfd + 10);
  view.setUint16(gpsIfd + 14, 2, true);
  view.setUint16(gpsIfd + 16, 5, true);
  view.setUint32(gpsIfd + 18, 3, true);
  view.setUint32(gpsIfd + 22, rationals, true);
  view.setUint32(gpsIfd + 26, 0, true);
  LATITUDE.forEach((n, i) => view.setUint32(rationals + i * 4, n, true));
  const payload = concat(ascii("Exif\0\0"), tiff);
  const length = new Uint8Array(2);
  new DataView(length.buffer).setUint16(0, payload.length + 2);
  return concat(Uint8Array.of(0xff, 0xe1), length, payload);
}

/** A JPEG of `width` by `height` with a GPS tag, as a phone writes one. */
async function jpegWithGps(width: number, height: number): Promise<Uint8Array> {
  const encoded = await env.IMAGES.input(new Blob([await png(width, height)]).stream()).output({
    format: "image/jpeg",
  });
  const jpeg = new Uint8Array(await encoded.response().arrayBuffer());
  // The APP1 segment goes straight after the SOI marker, where cameras put it.
  return concat(jpeg.subarray(0, 2), exifWithGps(), jpeg.subarray(2));
}

/** The byte sequence's first index in `bytes`, or -1. */
function indexOf(bytes: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

// --- The routes ---

const setPhoto = (by: Device, body: Uint8Array) =>
  fetch("/v1/me/photo", {
    method: "PUT",
    headers: { ...by.auth, "content-type": "application/octet-stream" },
    body,
  });

const photoOf = (by: Device, owner: Device) =>
  fetch(`/v1/accounts/${owner.accountId}/photo`, { headers: by.auth });

async function json<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

const profileOf = (by: Device, owner: Device) =>
  fetch(`/v1/accounts/${owner.accountId}`, { headers: by.auth }).then((r) =>
    json<{ name: string | null; photo: string | null }>(r),
  );

async function named(name: string) {
  const seeded = await device();
  await env.DB.prepare("UPDATE accounts SET display_name = ? WHERE account_id = ?")
    .bind(name, seeded.accountId)
    .run();
  return seeded;
}

async function withPhoto(name: string) {
  const owner = await named(name);
  const set = await json<{ photo: string }>(await setPhoto(owner, await png(40, 30)));
  return { owner, version: set.photo };
}

const block = (blocker: Device, target: Device) =>
  fetch(`/v1/blocks/${target.accountId}`, { method: "PUT", headers: blocker.auth });

describe("the profile photo (decision 0039)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("re-encodes an upload to a 512 px WebP without its GPS tag, for any signed-in account", async () => {
    const [owner, reader] = [await named("Ljósmynda Eigandi"), await device()];
    const upload = await jpegWithGps(900, 600);
    expect(indexOf(upload, ascii("Exif\0\0"))).toBeGreaterThan(0);
    const set = await setPhoto(owner, upload);
    const { photo } = await json<{ photo: string }>(set);

    const fetched = await photoOf(reader, owner);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toBe("image/webp");
    const stored = new Uint8Array(await fetched.arrayBuffer());
    expect(new TextDecoder().decode(stored.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(stored.subarray(8, 12))).toBe("WEBP");
    const info = await env.IMAGES.info(new Blob([stored]).stream());
    expect(info).toMatchObject({ format: "image/webp", width: 512, height: 512 });
    // No EXIF chunk, no TIFF header, and not the latitude's bytes.
    expect(indexOf(stored, ascii("EXIF"))).toBe(-1);
    expect(indexOf(stored, ascii("Exif"))).toBe(-1);
    expect(indexOf(stored, ascii("II*\0"))).toBe(-1);
    expect(indexOf(stored, Uint8Array.of(5055 & 0xff, 5055 >> 8, 0, 0, 100, 0, 0, 0))).toBe(-1);

    // The version is in every profile: the account, the directory, Fljótið and Ég.
    expect((await profileOf(reader, owner)).photo).toBe(photo);
    const people = await json<{ people: { accountId: string; photo: string | null }[] }>(
      await fetch("/v1/people?q=ljosmynda", { headers: reader.auth }),
    );
    expect(people.people.find((p) => p.accountId === owner.accountId)?.photo).toBe(photo);
    const posted = await fetch("/v1/posts", {
      method: "POST",
      headers: { ...owner.auth, "content-type": "application/json" },
      body: JSON.stringify({ body: "Halló" }),
    });
    const { postId } = (await posted.json()) as { postId: string };
    const read = await json<{ author: { photo: string | null } }>(
      await fetch(`/v1/posts/${postId}`, { headers: reader.auth }),
    );
    expect(read.author.photo).toBe(photo);
    const me = await json<{ photo: string | null }>(await fetch("/v1/me", { headers: owner.auth }));
    expect(me.photo).toBe(photo);
  });

  it("replaces the photo with a new version, and removes it", async () => {
    const { owner, version } = await withPhoto("Skipti Mynd");
    const replaced = await json<{ photo: string }>(await setPhoto(owner, await png(10, 20)));
    expect(replaced.photo).not.toBe(version);
    expect((await profileOf(owner, owner)).photo).toBe(replaced.photo);

    const removed = await fetch("/v1/me/photo", { method: "DELETE", headers: owner.auth });
    expect(removed.status).toBe(204);
    expect((await profileOf(owner, owner)).photo).toBeNull();
    expect((await photoOf(owner, owner)).status).toBe(404);
    expect(await env.PROFILES.head(owner.accountId)).toBeNull();
    // Removing none is no error.
    expect((await fetch("/v1/me/photo", { method: "DELETE", headers: owner.auth })).status).toBe(
      204,
    );
  });

  it("refuses what is not an image, an upload over 10 MB, and keeps the photo it had", async () => {
    const { owner, version } = await withPhoto("Hafnað Mynd");
    const garbage = await setPhoto(owner, ascii("not an image at all"));
    expect(garbage.status).toBe(400);
    expect(await errorOf(garbage)).toBe("invalid_image");
    const huge = await setPhoto(owner, new Uint8Array(10 * 1024 * 1024 + 1));
    expect(huge.status).toBe(413);
    expect(await errorOf(huge)).toBe("too_large");
    expect((await profileOf(owner, owner)).photo).toBe(version);
    expect((await photoOf(owner, owner)).status).toBe(200);
  });

  it("is withheld both ways across a block, as if there were none, but the name is not", async () => {
    const { owner } = await withPhoto("Lokandi Mynd");
    const [blocked, blocker] = [await device(), await device()];
    await block(owner, blocked);
    await block(blocker, owner);
    for (const viewer of [blocked, blocker]) {
      const seen = await profileOf(viewer, owner);
      expect(seen).toMatchObject({ name: "Lokandi Mynd", photo: null });
      const refused = await photoOf(viewer, owner);
      expect(refused.status).toBe(404);
      expect(await errorOf(refused)).toBe("not_found");
    }
    // The blocked account still reads the owner's posts, without the photo.
    const posted = await fetch("/v1/posts", {
      method: "POST",
      headers: { ...owner.auth, "content-type": "application/json" },
      body: JSON.stringify({ body: "Halló" }),
    });
    const { postId } = (await posted.json()) as { postId: string };
    const read = await json<{ author: { name: string; photo: string | null } }>(
      await fetch(`/v1/posts/${postId}`, { headers: blocked.auth }),
    );
    expect(read.author).toMatchObject({ name: "Lokandi Mynd", photo: null });
  });

  it("answers an account with no photo, or none at all, with 404", async () => {
    const [reader, bare] = [await device(), await device()];
    expect((await profileOf(reader, bare)).photo).toBeNull();
    expect((await photoOf(reader, bare)).status).toBe(404);
    const missing = await fetch("/v1/accounts/acct_nobody/photo", { headers: reader.auth });
    expect(missing.status).toBe(404);
  });

  it("is deleted with the account", async () => {
    const { owner } = await withPhoto("Eytt Mynd");
    expect(await env.PROFILES.head(owner.accountId)).not.toBeNull();
    await deleteAccount(euEnv(env), owner.accountId);
    expect(await env.PROFILES.head(owner.accountId)).toBeNull();
  });

  it("logs that a photo was set, with the account id and a size, never its version", async () => {
    const owner = await device();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { photo } = await json<{ photo: string }>(await setPhoto(owner, await png(16, 16)));
    const lines = spy.mock.calls.map(([line]) => String(line));
    const set = lines.map((l) => JSON.parse(l)).find((l) => l.event === "photo.set");
    expect(set).toMatchObject({ accountId: owner.accountId });
    expect(set.size).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(photo);
  });

  it("needs a device token", async () => {
    expect((await fetch("/v1/me/photo", { method: "PUT", body: "x" })).status).toBe(401);
  });
});
