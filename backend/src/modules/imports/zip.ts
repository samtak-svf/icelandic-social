// A reader for the ZIP an export arrives as, over ranged reads of an R2 object: the
// archive can be gigabytes, so only the end of the file, the central directory and
// the one entry asked for are ever in memory. Stored and deflated entries only;
// zip64 and encrypted archives are refused with a code, never read on.

export type ZipFailure =
  | "truncated"
  | "zip64"
  | "encrypted"
  | "unsupported"
  | "too_big"
  | "corrupt";

export class ZipError extends Error {
  readonly code: ZipFailure;
  constructor(code: ZipFailure) {
    super(`zip: ${code}`);
    this.code = code;
  }
}

export type ZipEntry = {
  name: string;
  method: 0 | 8;
  compressedSize: number;
  size: number;
  localOffset: number;
};

/** A central directory larger than this is not an export. */
const MAX_DIRECTORY = 16 * 1024 * 1024;

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** The end record is 22 bytes, then a comment of up to 65535. */
const EOCD_WINDOW = 22 + 0xffff;

export type ZipSource = {
  size: number;
  /** `length` bytes from `offset`; fewer or none means the object is cut short. */
  read: (offset: number, length: number) => Promise<Uint8Array | null>;
};

/** A source over an R2 object of `size` bytes. */
export function r2Source(bucket: R2Bucket, key: string, size: number): ZipSource {
  return {
    size,
    async read(offset, length) {
      const object = await bucket.get(key, { range: { offset, length } });
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
  };
}

async function exact(source: ZipSource, offset: number, length: number): Promise<DataView> {
  if (offset < 0 || length < 0 || offset + length > source.size) throw new ZipError("truncated");
  const bytes = await source.read(offset, length);
  if (!bytes || bytes.length !== length) throw new ZipError("truncated");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The end record: where the central directory is, and how many entries it holds. */
async function endRecord(source: ZipSource) {
  const windowLength = Math.min(source.size, EOCD_WINDOW);
  const tail = await exact(source, source.size - windowLength, windowLength);
  let at = windowLength - 22;
  while (at >= 0 && tail.getUint32(at, true) !== EOCD) at--;
  if (at < 0) throw new ZipError("truncated");
  if (at >= 20 && tail.getUint32(at - 20, true) === EOCD64_LOCATOR) throw new ZipError("zip64");
  const count = tail.getUint16(at + 10, true);
  const length = tail.getUint32(at + 12, true);
  const offset = tail.getUint32(at + 16, true);
  if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff) {
    throw new ZipError("zip64");
  }
  if (length > MAX_DIRECTORY) throw new ZipError("too_big");
  return { count, length, offset };
}

/** The directory record at `cursor`: the entry (null for a folder) and the next cursor. */
function recordAt(directory: DataView, cursor: number, length: number) {
  if (cursor + 46 > length || directory.getUint32(cursor, true) !== CENTRAL) {
    throw new ZipError("corrupt");
  }
  const flags = directory.getUint16(cursor + 8, true);
  const method = directory.getUint16(cursor + 10, true);
  const compressedSize = directory.getUint32(cursor + 20, true);
  const size = directory.getUint32(cursor + 24, true);
  const nameLength = directory.getUint16(cursor + 28, true);
  const next =
    cursor +
    46 +
    nameLength +
    directory.getUint16(cursor + 30, true) +
    directory.getUint16(cursor + 32, true);
  const localOffset = directory.getUint32(cursor + 42, true);
  if (next > length) throw new ZipError("corrupt");
  // Encryption is refused before anything else about the entry is believed.
  if (flags & 0x1 || flags & 0x40) throw new ZipError("encrypted");
  if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
    throw new ZipError("zip64");
  }
  const name = new TextDecoder("utf-8").decode(
    new Uint8Array(directory.buffer, directory.byteOffset + cursor + 46, nameLength),
  );
  if (name.endsWith("/")) return { entry: null, next };
  if (method !== 0 && method !== 8) throw new ZipError("unsupported");
  return { entry: { name, method, compressedSize, size, localOffset } satisfies ZipEntry, next };
}

/** The entries of the archive, from its end record and central directory. */
export async function readDirectory(source: ZipSource): Promise<ZipEntry[]> {
  const { count, length, offset } = await endRecord(source);
  const directory = await exact(source, offset, length);
  const entries: ZipEntry[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const read = recordAt(directory, cursor, length);
    if (read.entry) entries.push(read.entry);
    cursor = read.next;
  }
  return entries;
}

/** Inflates `data`, counting what comes out so a bomb stops at `max` bytes. */
async function inflate(data: Uint8Array, max: number): Promise<Uint8Array> {
  const reader = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel();
        throw new ZipError("too_big");
      }
      chunks.push(value);
    }
  } catch (error) {
    throw error instanceof ZipError ? error : new ZipError("corrupt");
  }
  const out = new Uint8Array(total);
  let written = 0;
  for (const chunk of chunks) {
    out.set(chunk, written);
    written += chunk.length;
  }
  return out;
}

/** The bytes of `entry`, refused as `too_big` the moment they pass `max`. */
export async function readEntry(
  source: ZipSource,
  entry: ZipEntry,
  max: number,
): Promise<Uint8Array> {
  if (entry.size > max || entry.compressedSize > max) throw new ZipError("too_big");
  const local = await exact(source, entry.localOffset, 30);
  if (local.getUint32(0, true) !== LOCAL) throw new ZipError("corrupt");
  const start = entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const view = await exact(source, start, entry.compressedSize);
  const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (entry.method === 0) return data;
  return inflate(data, max);
}
