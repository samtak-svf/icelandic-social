import { describe, expect, it } from "vitest";
import type { CoreEvent } from "../generated/core.d.ts";
import { groupPhotoProblem, noteGroupPhoto, photoChange, photoKey } from "./group-photo.ts";

const message = (kind: string): CoreEvent => ({
  kind: "message",
  message: {
    conversation: "c-1",
    seq: 4,
    senderAccount: "a-1",
    senderDevice: "d-1",
    envelope: { id: "env-9", ts: 1, body: { kind } },
    own: false,
  },
});

describe("a group's photo on the page (0094)", () => {
  it("is fetched again when the revision changes with the same path", () => {
    const path = "group-photo/c-1.jpg";
    expect(photoKey(path, "env-1")).not.toBe(photoKey(path, "env-2"));
    expect(photoKey(path, "env-1")).toBe(photoKey(path, "env-1"));
  });

  it("has nothing to fetch without a path", () => {
    expect(photoKey(null, "env-1")).toBeNull();
  });

  it("notes a change idempotently", () => {
    expect(() => {
      noteGroupPhoto("c-1", "env-1");
      noteGroupPhoto("c-1", "env-1");
    }).not.toThrow();
  });

  it("finds a photo change among the events of a sync", () => {
    expect(photoChange([message("text"), message("photo")])).toEqual({
      conversation: "c-1",
      id: "env-9",
    });
    expect(photoChange([message("text")])).toBeNull();
  });

  it("gives an unreadable image no retry and any other failure the generic line", () => {
    expect(groupPhotoProblem({ code: "unsupported-image", message: "x" })).toBe("unsupported");
    expect(groupPhotoProblem({ code: "unreachable", message: "x" })).toBe("failed");
    expect(groupPhotoProblem({ code: "group/not-a-group", message: "x" })).toBe("failed");
    expect(groupPhotoProblem(new Error("boom"))).toBe("failed");
  });
});
