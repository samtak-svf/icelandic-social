// @ts-check
// Icon rasterisation. The output is committed and drift-checked byte for
// byte, so it must not vary between runs or machines: resvg renders with no
// system fonts (the source has no text) and the PNG carries no metadata.

import { deflateSync, crc32 } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

/**
 * @param {string} svg
 * @param {number} size output width and height in pixels
 * @param {string} [background] CSS colour painted under the SVG
 */
function render(svg, size, background) {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
    ...(background ? { background } : {}),
  }).render();
}

/**
 * A transparent PNG of the SVG, as resvg encodes it.
 *
 * @param {string} svg
 * @param {number} size
 * @returns {Buffer}
 */
export function renderPng(svg, size) {
  return render(svg, size).asPng();
}

/**
 * @param {string} type
 * @param {Buffer} data
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * The SVG flattened onto an opaque background, as an RGB PNG with no alpha
 * channel: App Store Connect rejects an app icon that has one.
 *
 * @param {string} svg
 * @param {number} size
 * @param {string} background
 * @returns {Buffer}
 */
export function renderOpaquePng(svg, size, background) {
  const image = render(svg, size, background);
  const rgba = image.pixels;
  const { width, height } = image;
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      if (rgba[from + 3] !== 255) throw new Error("icon background is not opaque");
      rgba.copy(rows, row + 1 + x * 3, from, from + 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, deflate, no filter method, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
