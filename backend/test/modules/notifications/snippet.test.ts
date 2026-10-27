import { describe, expect, it } from "vitest";
import { ok } from "../../people.ts";
import { inbox, recorder, run, scene } from "./support.ts";

// The snippet (decision 0105) is read when the page is, never stored, and only
// for a reader who may see what it quotes.

async function comment(body: string) {
  const { author, readers, postId } = await scene("A");
  const [a] = readers as [(typeof readers)[0]];
  const { commentId } = await ok<{ commentId: string }>(
    await a.call("POST", `/v1/posts/${postId}/comments`, { body }),
  );
  await run(recorder());
  return { author, a, postId, commentId };
}

describe("notification snippet", () => {
  it("quotes the newest comment, and the post for a reaction", async () => {
    const { author, a, postId } = await comment("  Halló\n  heimur  ");
    await a.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await run(recorder());
    const rows = (await inbox(author)).notifications;
    expect(rows.find((r) => r.kind === "comment")!.snippet).toBe("Halló heimur");
    expect(rows.find((r) => r.kind === "reaction")!.snippet).toBe("Póstur");
  });

  it("is null once the comment is deleted", async () => {
    const { author, a, commentId } = await comment("Hæ");
    expect((await inbox(author)).notifications[0]!.snippet).toBe("Hæ");
    expect((await a.call("DELETE", `/v1/comments/${commentId}`)).status).toBe(204);
    expect((await inbox(author)).notifications[0]!.snippet).toBeNull();
  });

  it("is null for a reader who blocked the comment's author", async () => {
    const { readers, postId } = await scene("A", "B");
    const [a, b] = readers as [(typeof readers)[0], (typeof readers)[0]];
    const { commentId } = await ok<{ commentId: string }>(
      await a.call("POST", `/v1/posts/${postId}/comments`, { body: "Fyrst" }),
    );
    await b.call("POST", `/v1/posts/${postId}/comments`, {
      body: "Svar",
      parentCommentId: commentId,
    });
    await run(recorder());
    const before = (await inbox(a)).notifications;
    expect(before.map((r) => [r.kind, r.snippet])).toEqual([["reply", "Svar"]]);
    expect((await a.call("PUT", `/v1/blocks/${b.accountId}`)).status).toBe(204);
    expect((await inbox(a)).notifications.map((r) => r.snippet)).toEqual([null]);
  });

  it("cuts at 100 graphemes, not code units, with an ellipsis", async () => {
    const family = "👨‍👩‍👧";
    const { author } = await comment(family.repeat(100) + "x");
    const snippet = (await inbox(author)).notifications[0]!.snippet!;
    expect([...new Intl.Segmenter().segment(snippet)]).toHaveLength(101);
    expect(snippet).toBe(family.repeat(100) + "…");
    const short = await comment("a".repeat(100));
    expect((await inbox(short.author)).notifications[0]!.snippet).toBe("a".repeat(100));
  });
});
