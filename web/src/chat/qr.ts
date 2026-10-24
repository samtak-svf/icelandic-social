// The link QR as vector rectangles (decision 0081): the core returns a
// `size × size` matrix, one byte per module, non-zero where the module is dark.
// One unit square per dark module; the viewBox is the matrix itself.

import type { LinkQr } from "../generated/core.d.ts";

export interface Rect {
  x: number;
  y: number;
}

export function qrRects(qr: LinkQr): Rect[] {
  const rects: Rect[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y * qr.size + x] !== 0) rects.push({ x, y });
    }
  }
  return rects;
}
