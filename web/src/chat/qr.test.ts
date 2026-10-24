import { expect, test } from "vitest";
import { qrRects } from "./qr.ts";

test("one rect per dark module, at its column and row", () => {
  // 1 0 1
  // 0 1 0
  // 0 0 1
  const modules = Uint8Array.from([1, 0, 1, 0, 1, 0, 0, 0, 1]);
  expect(qrRects({ size: 3, modules })).toEqual([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ]);
});

test("an all-light matrix draws nothing", () => {
  expect(qrRects({ size: 2, modules: new Uint8Array(4) })).toEqual([]);
});
