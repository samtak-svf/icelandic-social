import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { mediaBucket } from "../../../src/env/index.ts";
import { jobHandlers } from "../../../src/compose/job-handlers.ts";
import { runJobs } from "../../../src/modules/jobs/index.ts";
import { crc32 } from "../../images.ts";
import { type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import { readDirectory, readEntry, r2Source } from "../../../src/modules/imports/zip.ts";

export const E = euEnv(env);

/** Runs the due jobs until none is left. */
export async function drain(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const { done, retried } = await runJobs(E, jobHandlers(E), Date.now() + 1);
    expect(retried).toBe(0);
    if (done === 0) return;
  }
  throw new Error("the jobs did not finish");
}

export type Summary = {
  exportId: string;
  state: string;
  failure: string | null;
  size: number | null;
  createdAt: number;
  expiresAt: number;
};

/** Asks for an export as `by` and runs its build to the end. */
export async function exported(by: Person): Promise<Summary> {
  const made = await by.call("POST", "/v1/exports");
  expect(made.status).toBe(201);
  const { exportId } = (await made.json()) as Summary;
  await drain();
  return stateOf(by, exportId);
}

export async function stateOf(by: Person, exportId: string): Promise<Summary> {
  const list = (await (await by.call("GET", "/v1/exports")).json()) as { exports: Summary[] };
  return list.exports.find((e) => e.exportId === exportId)!;
}

/** Every entry of the file by name, read with the importer's own reader, its CRC checked against the directory. */
export async function readZip(exportId: string): Promise<Map<string, Uint8Array>> {
  const bucket = mediaBucket(E);
  const key = `exports/${exportId}.zip`;
  const head = await bucket.head(key);
  const source = r2Source(bucket, key, head!.size);
  const bytes = new Uint8Array(await (await mediaBucket(E).get(key))!.arrayBuffer());
  const crcs = directoryCrcs(bytes);
  const entries = new Map<string, Uint8Array>();
  for (const entry of await readDirectory(source)) {
    expect(entries.has(entry.name), `duplicate entry ${entry.name}`).toBe(false);
    const data = await readEntry(source, entry, 50_000_000);
    expect(crc32(data), `crc of ${entry.name}`).toBe(crcs.get(entry.name));
    entries.set(entry.name, data);
  }
  expect(entries.size).toBe(crcs.size);
  return entries;
}

/** The names and CRCs the central directory states, parsed here and not by the reader under test. */
function directoryCrcs(bytes: Uint8Array): Map<string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    out.set(name, view.getUint32(at + 16, true));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}

export const text = (entries: Map<string, Uint8Array>, name: string) =>
  new TextDecoder().decode(entries.get(name));
export const jsonOf = <T = unknown>(entries: Map<string, Uint8Array>, name: string) =>
  JSON.parse(text(entries, name)) as T;

/** Bytes deflate cannot shrink, standing in for a large image, so a few of them fill the parts of a file. */
export function heavy(size = 1_400_000): Uint8Array {
  const out = new Uint8Array(size);
  for (let off = 0; off < size; off += 65536)
    crypto.getRandomValues(out.subarray(off, Math.min(off + 65536, size)));
  return out;
}

/** Every entry's size and SHA-256, export.json without its own id, so two files compare without two copies in memory. */
export async function digest(exportId: string): Promise<[string, number, string][]> {
  const zip = await readZip(exportId);
  const out: [string, number, string][] = [];
  for (const [name, bytes] of zip) {
    const shown =
      name === "export.json"
        ? new TextEncoder().encode(text(zip, name).replace(exportId, "<id>"))
        : bytes;
    const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", shown));
    out.push([name, bytes.length, [...sha].map((b) => b.toString(16).padStart(2, "0")).join("")]);
  }
  return out;
}
