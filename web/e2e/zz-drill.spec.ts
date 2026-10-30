import { expect, test } from "@playwright/test";

for (const n of [1, 2, 3, 4]) {
  test(`drill ${n}: a failing test`, () => {
    expect(n).toBe(0);
  });
}
