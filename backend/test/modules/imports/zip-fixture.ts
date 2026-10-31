import { ascii, concat, crc32 } from "../../images.ts";

// A real ZIP, built in the test: stored and deflated entries, and the few damaged
// shapes the reader must refuse. Nothing here reads a file from disk.

export type FixtureEntry = {
  name: string;
  data: Uint8Array;
  method?: "store" | "deflate";
  /** Sets the encryption flag. */
  encrypted?: boolean;
  /** Writes the zip64 marker in the entry's sizes. */
  zip64?: boolean;
  /** What the central directory claims the inflated size is. */
  declaredSize?: number;
};

const le = (bytes: number, n: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out.subarray(0, bytes);
};

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function buildZip(entries: FixtureEntry[]): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = ascii(entry.name);
    const packed = entry.method === "deflate" ? await deflate(entry.data) : entry.data;
    const flags = entry.encrypted ? 1 : 0;
    const method = entry.method === "deflate" ? 8 : 0;
    const crc = crc32(entry.data);
    const local = concat(
      le(4, 0x04034b50),
      le(2, 20),
      le(2, flags),
      le(2, method),
      le(4, 0),
      le(4, crc),
      le(4, packed.length),
      le(4, entry.data.length),
      le(2, name.length),
      le(2, 0),
      name,
      packed,
    );
    const marker = 0xffffffff;
    centrals.push(
      concat(
        le(4, 0x02014b50),
        le(2, 20),
        le(2, 20),
        le(2, flags),
        le(2, method),
        le(4, 0),
        le(4, crc),
        le(4, entry.zip64 ? marker : packed.length),
        le(4, entry.zip64 ? marker : (entry.declaredSize ?? entry.data.length)),
        le(2, name.length),
        le(2, 0),
        le(2, 0),
        le(2, 0),
        le(2, 0),
        le(4, 0),
        le(4, offset),
        name,
      ),
    );
    locals.push(local);
    offset += local.length;
  }
  const directory = concat(...centrals);
  return concat(
    ...locals,
    directory,
    le(4, 0x06054b50),
    le(2, 0),
    le(2, 0),
    le(2, entries.length),
    le(2, entries.length),
    le(4, directory.length),
    le(4, offset),
    le(2, 0),
  );
}
