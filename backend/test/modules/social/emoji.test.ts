import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Emoji, isEmoji } from "../../../src/api/emoji.ts";
import { emojiOfKind, kindOfEmoji } from "../../../src/api/social.ts";
import { ensureEmojiReactions } from "../../../src/modules/social/do/reactions.ts";

// The one rule for "an emoji" a post reaction takes (decision 0100).

describe("isEmoji", () => {
  it("takes one emoji of any shape", () => {
    for (const e of [
      "👍",
      "❤️",
      "🙏",
      "😢",
      "👍🏽",
      "✌🏽",
      "👨‍👩‍👧‍👦",
      "🏳️‍🌈",
      "🇮🇸",
      "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
      "1️⃣",
      "#️⃣",
      "☺️",
    ]) {
      expect(isEmoji(e), e).toBe(true);
    }
  });

  it("refuses anything that is not exactly one emoji", () => {
    for (const s of [
      "",
      "a",
      "like",
      "👍👍",
      "👍a",
      " 👍",
      "👍 ",
      "ab😀",
      "1",
      "©",
      "❤",
      "‍",
      "🇮",
    ]) {
      expect(isEmoji(s), JSON.stringify(s)).toBe(false);
    }
    expect(isEmoji("👍".repeat(40))).toBe(false);
    expect(Emoji.safeParse("x").success).toBe(false);
    expect(Emoji.safeParse(5).success).toBe(false);
  });
});

describe("the five old kinds", () => {
  it("map to an emoji and back", () => {
    expect(emojiOfKind("like")).toBe("👍");
    expect(emojiOfKind("love")).toBe("❤️");
    expect(emojiOfKind("laugh")).toBe("😂");
    expect(emojiOfKind("wow")).toBe("😮");
    expect(emojiOfKind("sad")).toBe("😢");
    expect(kindOfEmoji("😮")).toBe("wow");
    expect(kindOfEmoji("🙏")).toBeNull();
  });
});

describe("the stored reactions", () => {
  it("migrates the old kind column to the emoji, once", async () => {
    await runInDurableObject(env.SPACE.getByName("c_emoji_migration"), (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec("DROP TABLE reactions");
      sql.exec(
        "CREATE TABLE reactions (post_id TEXT NOT NULL, account TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, account))",
      );
      for (const [i, kind] of ["like", "love", "laugh", "wow", "sad"].entries()) {
        sql.exec("INSERT INTO reactions VALUES ('p1', ?, ?, 1)", `a${i}`, kind);
      }
      ensureEmojiReactions(sql);
      const read = () =>
        sql
          .exec<{ emoji: string }>("SELECT emoji FROM reactions ORDER BY account")
          .toArray()
          .map((r) => r.emoji);
      expect(read()).toEqual(["👍", "❤️", "😂", "😮", "😢"]);
      ensureEmojiReactions(sql);
      expect(read()).toEqual(["👍", "❤️", "😂", "😮", "😢"]);
    });
  });
});
