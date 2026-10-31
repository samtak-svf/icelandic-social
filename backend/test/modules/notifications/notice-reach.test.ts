import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CLIENT_HEADER } from "../../../src/shared/client-version.ts";
import { worker } from "../../main.ts";
import { community, ok, person, type Person } from "../../people.ts";
import { wallPost } from "../social/wall-support.ts";
import { recorder, run } from "./support.ts";

// The invariant behind the notice seams (decisions 0114, 0115), read off the real
// configuration: a released app never gets a row its core cannot draw, in its list
// or its counts, and the release whose core has friends and the wall gets them all.

type Page = {
  notifications: { kind: string; action?: string | null }[];
  unread: number;
  unseen: number;
};

const read = async (one: Person, client: string) =>
  ok<Page>(
    await worker.fetch("https://spjall.test/v1/notifications", {
      headers: { ...one.auth, [CLIENT_HEADER]: client },
    }),
  );

const insert = (id: string, account: string, kind: string, action: string | null) =>
  env.DB.prepare(
    `INSERT INTO notifications (notification_id, account_id, kind, action, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, account, kind, action, Date.now())
    .run();

/** Every row the new core has words for and no released app has: 0.20 and below. */
async function ownerOfNewRows() {
  const owner = await person("eigandi");
  const reader = await person("lesandi");
  const post = await wallPost(owner, "everyone");
  await ok(await reader.call("POST", `/v1/posts/${post.postId}/comments`, { body: "Texti" }));
  for (let pass = 0; pass < 20; pass++) await run(recorder());
  await insert(`friend-request-${owner.accountId}`, owner.accountId, "friend_request", null);
  await insert(`friend-accepted-${owner.accountId}`, owner.accountId, "friend_accepted", null);
  await insert(`bio-${owner.accountId}`, owner.accountId, "moderated", "clear_account_bio");
  await insert(`cover-${owner.accountId}`, owner.accountId, "moderated", "clear_account_cover");
  return owner;
}

describe("the notice seams", () => {
  it.each(["0.17.7", "0.19.0", "0.20.0", "0.20.9"])(
    "keep every new row from an app at %s, in its list and its counts",
    async (version) => {
      const owner = await ownerOfNewRows();
      for (const platform of ["android", "ios"]) {
        const page = await read(owner, `${platform}/${version}`);
        expect(page.notifications).toEqual([]);
        expect(page.unread).toBe(0);
        expect(page.unseen).toBe(0);
      }
    },
  );

  // An app below the first core with the reply kind drops those rows from its list,
  // while the counters would still count them.
  it.each(["0.16.2", "0.16.9"])(
    "keep a reply from an app at %s, in its list and its counts",
    async (version) => {
      const owner = await person("eigandi");
      const id = await community(owner, "open");
      for (const kind of ["comment", "reply"]) {
        await env.DB.prepare(
          `INSERT INTO notifications (notification_id, account_id, kind, community_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(`${kind}-${owner.accountId}`, owner.accountId, kind, id, Date.now())
          .run();
      }
      for (const platform of ["android", "ios"]) {
        const page = await read(owner, `${platform}/${version}`);
        expect(page.notifications.map((n) => n.kind)).toEqual(["comment"]);
        expect(page.unread).toBe(1);
        expect(page.unseen).toBe(1);
      }
      const knowing = await read(owner, `android/${env.REPLY_NOTICE_CLIENT_VERSION}`);
      expect(knowing.notifications.map((n) => n.kind).sort()).toEqual(["comment", "reply"]);
      expect(knowing.unread).toBe(2);
    },
  );

  it("give the release that has friends and the wall every new row", async () => {
    const owner = await ownerOfNewRows();
    for (const platform of ["android", "ios"]) {
      const page = await read(owner, `${platform}/0.21.0`);
      expect(page.notifications.map((n) => n.kind).sort()).toEqual([
        "comment",
        "friend_accepted",
        "friend_request",
        "moderated",
        "moderated",
      ]);
      expect(page.notifications.flatMap((n) => n.action ?? []).sort()).toEqual([
        "clear_account_bio",
        "clear_account_cover",
      ]);
      expect(page.unread).toBe(5);
    }
  });

  it("still keep the moderators' notice from every app", async () => {
    const owner = await person("eigandi");
    await insert(`queue-${owner.accountId}`, owner.accountId, "reports_waiting", null);
    expect((await read(owner, "android/0.21.0")).notifications).toEqual([]);
  });
});
