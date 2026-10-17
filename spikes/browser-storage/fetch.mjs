// Fetches the published sqlite3mc wasm build, pinned by version and SHA-256,
// and unpacks the two files the page loads into vendor/ (gitignored).
// The checksum is the one in the release's own sqlite3mc-2.5.1-SHA256SUMS.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const RELEASE = "v2.5.1";
const ZIP = "sqlite3mc-2.5.1-sqlite-3.53.4-wasm.zip";
const SHA256 = "761a41b8dc996cfa21f193fc044739fbb0c4a31a1fd657a4df49cc59085577ce";
const URL = `https://github.com/utelle/SQLite3MultipleCiphers/releases/download/${RELEASE}/${ZIP}`;
const WANTED = ["jswasm/sqlite3.mjs", "jswasm/sqlite3.wasm"];

const VENDOR = join(import.meta.dirname, "vendor");

/**
 * Reads the named entries from a zip archive (stored or deflated).
 * @param {Buffer} zip
 * @param {string[]} names suffixes of the entry paths
 */
function unzip(zip, names) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  /** @type {Map<string, Buffer>} */
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const skip = nameLen + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLen);
    const local = zip.readUInt32LE(at + 42);
    const wanted = names.find((n) => name.endsWith(n));
    if (wanted) {
      const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(data, data + size);
      out.set(wanted, method === 0 ? raw : inflateRawSync(raw));
    }
    at += 46 + skip;
  }
  return out;
}

if (WANTED.every((n) => existsSync(join(VENDOR, n.split("/").at(-1) ?? n)))) {
  console.log("vendor/ already holds sqlite3mc", RELEASE);
} else {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`GET ${URL}: ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  const sum = createHash("sha256").update(zip).digest("hex");
  if (sum !== SHA256) throw new Error(`${ZIP}: SHA-256 ${sum}, expected ${SHA256}`);
  mkdirSync(VENDOR, { recursive: true });
  for (const [name, bytes] of unzip(zip, WANTED)) {
    writeFileSync(join(VENDOR, name.split("/").at(-1) ?? name), bytes);
  }
  console.log("sqlite3mc", RELEASE, "verified and unpacked into vendor/");
}
