import { describe, expect, it } from "vitest";
import { initials } from "./avatar.tsx";
import { commentThreads, isTombstone } from "./comments.ts";
import type { Comment } from "../generated/api.ts";

// The initials stand-ins and the comment threads of decision 0071.

const at = (parentCommentId: string | null): Comment => ({
  commentId: `post-1-${Math.random().toString(36).slice(2, 8)}`,
  postId: "post-1",
  parentCommentId,
  author: { accountId: "a", name: "Nafn", verified: true, photo: null, role: null },
  body: "",
  createdAt: Date.now(),
  state: "visible",
  likes: 0,
  liked: false,
});

describe("initials", () => {
  it("take the first letter of the name", () => {
    expect(initials("Garðar Pálsson")).toBe("G");
    expect(initials("  jón ")).toBe("J");
    expect(initials("ásmundur")).toBe("Á");
  });

  it("stand in Nafnlaus where no name came", () => {
    expect(initials(null)).toBe("N");
    expect(initials("  ")).toBe("N");
  });
});

describe("the comment threads", () => {
  it("group replies under their parent, oldest first", () => {
    const a = at(null);
    const reply = at(a.commentId);
    const b = at(null);
    const threads = commentThreads([a, reply, b]);
    expect(threads.map((t) => t.comment.commentId)).toEqual([a.commentId, b.commentId]);
    expect(threads[0]?.replies.map((c) => c.commentId)).toEqual([reply.commentId]);
  });

  it("answer an unknown or nested parent as a top-level comment", () => {
    const own = at(null);
    const nested = at(own.commentId);
    const stray = at("post-1-missing");
    const replyToReply = at(nested.commentId);
    const threads = commentThreads([own, nested, stray, replyToReply]);
    expect(threads.map((t) => t.comment.commentId)).toEqual([
      own.commentId,
      stray.commentId,
      replyToReply.commentId,
    ]);
  });

  it("mark a removed comment the body left as a tombstone", () => {
    const gone = { ...at(null), body: "", state: "removed" as const };
    expect(isTombstone(gone)).toBe(true);
    expect(isTombstone({ ...at(null), body: "", state: "hidden" as const })).toBe(false);
    expect(isTombstone({ ...at(null), body: "still here", state: "removed" as const })).toBe(false);
  });
});
