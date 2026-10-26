import { describe, expect, it } from "vitest";
import { pollEnds, whyBeginFailed } from "./link-page.tsx";
import { ChatFailure } from "./protocol.ts";

const failure = (code: string, message: string) => new ChatFailure({ code, message });

describe("linking this browser (0096)", () => {
  const offer = { expiresAt: 10_000 };

  it("keeps waiting when a check fails on the way", () => {
    expect(pollEnds(failure("unreachable", "offline"), offer, 9_000)).toBe(false);
    expect(pollEnds(failure("protocol", "malformed answer"), offer, 9_000)).toBe(false);
    expect(pollEnds(new Error("worker busy"), offer, 9_000)).toBe(false);
  });

  it("stops when the code has run out", () => {
    expect(pollEnds(failure("link-expired", "gone"), offer, 9_000)).toBe(true);
    expect(pollEnds(failure("unreachable", "offline"), offer, 10_000)).toBe(true);
  });

  it("says why a link could not begin", () => {
    expect(whyBeginFailed(failure("refused", "no_phone_device"))).toBe("no-phone");
    expect(whyBeginFailed(failure("unreachable", "offline"))).toBe("unreachable");
    expect(whyBeginFailed(failure("refused", "session_already_linked"))).toBe("other");
    expect(whyBeginFailed(new Error("boom"))).toBe("other");
  });

  it("treats a session the server no longer knows as signed out", () => {
    expect(whyBeginFailed(failure("refused", "unauthorized"))).toBeUndefined();
  });
});
