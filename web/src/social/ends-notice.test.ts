import { beforeEach, describe, expect, it, vi } from "vitest";

const unreadChanged = vi.fn();
vi.mock("../ui/unread.tsx", () => ({ unreadChanged: () => unreadChanged() }));

const { endsNotice } = await import("./ends-notice.ts");

describe("endsNotice", () => {
  beforeEach(() => unreadChanged.mockReset());

  it("asks the bell again after a call that succeeded, and passes the outcome on", async () => {
    const done = { ok: true as const, data: 1 };
    expect(await endsNotice(Promise.resolve(done))).toBe(done);
    expect(unreadChanged).toHaveBeenCalledTimes(1);
  });

  it("leaves the bell alone after a call that failed", async () => {
    const done = { ok: false as const, status: 500, problem: { kind: "unreachable" as const } };
    expect(await endsNotice(Promise.resolve(done))).toBe(done);
    expect(unreadChanged).not.toHaveBeenCalled();
  });
});
