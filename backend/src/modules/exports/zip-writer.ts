// A writer for the stored ZIP an export is (decision 0126): pure functions over bytes,
// no storage. Entries are stored, not deflated (images are WebP already), names are
// UTF-8, and the times are fixed so that the same content is the same bytes. The
// reader in modules/imports/zip.ts refuses zip64, so a file past ZIP32's limits is
// refused here with a code rather than written in a form our own reader would reject.

/** Entries a ZIP32 end record can count; 0xffff means "zip64" to a reader. */
export const MAX_ENTRIES = 0xfffe;
/** The largest offset or size ZIP32 can hold; 0xffffffff means "zip64". */
export const MAX_OFFSET = 0xfffffffe;

/** The file does not fit ZIP32; the export fails with `too_big` (decision 0126). */
export class ExportTooBig extends Error {
  readonly code = "too_big";
  constructor() {
    super("zip: too_big");
  }
}

export type DirectoryEntry = { name: string; crc: number; size: number; offset: number };

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `bytes`, as an unsigned integer. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00:00, the earliest time a ZIP can say; fixed so a rebuild is byte-identical. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** General purpose flag bit 11: the name is UTF-8. */
const UTF8 = 0x0800;
const encoder = new TextEncoder();

/** The local header, the name and the bytes of one stored entry. */
export function localEntry(name: string, bytes: Uint8Array, crc: number): Uint8Array {
  const nameBytes = encoder.encode(name);
  const out = new Uint8Array(30 + nameBytes.length + bytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, UTF8, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, DOS_TIME, true);
  view.setUint16(12, DOS_DATE, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, bytes.length, true);
  view.setUint32(22, bytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  out.set(nameBytes, 30);
  out.set(bytes, 30 + nameBytes.length);
  return out;
}

/** The central directory of `entries`, followed by the end record. */
export function centralDirectory(entries: DirectoryEntry[], directoryOffset: number): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new ExportTooBig();
  const names = entries.map((e) => encoder.encode(e.name));
  const length = names.reduce((sum, n) => sum + 46 + n.length, 0);
  if (directoryOffset + length > MAX_OFFSET) throw new ExportTooBig();
  const out = new Uint8Array(length + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  entries.forEach((entry, i) => {
    const name = names[i]!;
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, UTF8, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, DOS_TIME, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.size, true);
    view.setUint32(at + 24, entry.size, true);
    view.setUint16(at + 28, name.length, true);
    view.setUint32(at + 42, entry.offset, true);
    out.set(name, at + 46);
    at += 46 + name.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, length, true);
  view.setUint32(at + 16, directoryOffset, true);
  return out;
}
