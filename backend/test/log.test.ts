import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../src/log";

const lines = () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  return () => spy.mock.calls.map(([line]) => JSON.parse(String(line)));
};

describe("log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line with the event and the allowed fields", () => {
    const written = lines();
    log("message.stored", { conversationId: "c-1", seq: 7, durationMs: 3 });
    expect(written()).toEqual([
      { event: "message.stored", conversationId: "c-1", seq: 7, durationMs: 3 },
    ]);
  });

  it("drops a field that is not on the allow list", () => {
    const written = lines();
    log("auth.failed", { code: "token_expired", phone: "5551234" } as never);
    expect(written()).toEqual([{ event: "auth.failed", code: "token_expired" }]);
  });

  it("redacts a string that is not an opaque id", () => {
    const written = lines();
    log("request.failed", { code: "Jón Jónsson sent hi", deviceId: "d_9f3" });
    expect(written()).toEqual([{ event: "request.failed", code: "[redacted]", deviceId: "d_9f3" }]);
  });

  it("redacts a run of digits that could be a phone number or a kennitala", () => {
    const written = lines();
    const digits = "1".repeat(10);
    log("request.failed", { code: digits, deviceId: digits.slice(0, 7), accountId: "a_123" });
    expect(written()).toEqual([
      { event: "request.failed", code: "[redacted]", deviceId: "[redacted]", accountId: "a_123" },
    ]);
  });

  it("refuses an event name that is not a dotted identifier", () => {
    expect(() => log("user Jón logged in" as never, {})).toThrow(/event/);
  });
});
