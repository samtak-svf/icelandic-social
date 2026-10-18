// Images built in the test, so no fixture file holds one.

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

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const ascii = (text: string) => new TextEncoder().encode(text);

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
export async function png(width: number, height: number): Promise<Uint8Array> {
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
