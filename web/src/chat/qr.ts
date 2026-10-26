// The link QR as vector rectangles (decision 0081): the core returns a
// `size × size` matrix, one byte per module, non-zero where the module is dark.
// One unit square per dark module, on a light square that takes in the quiet
// zone, so the code reads the same whatever colours the page around it has.

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

/** The light margin around the code, in modules: the least ISO/IEC 18004 allows. */
export const QUIET_ZONE = 4;

/** The square the code is drawn on: the matrix and its quiet zone on every side. */
export function qrFrame(qr: Pick<LinkQr, "size">): { origin: number; side: number } {
  return { origin: -QUIET_ZONE, side: qr.size + 2 * QUIET_ZONE };
}
