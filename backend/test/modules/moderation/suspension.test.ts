import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp, DOCUMENT_INFO } from "../../../src/app.ts";
import { deleteOrphans } from "../../../src/compose/account-deletion.ts";
import { CLIENT_HEADER } from "../../../src/shared/client-version.ts";
import { base64url } from "../../../src/shared/bytes.ts";
import { png } from "../../images.ts";
import { worker } from "../../main.ts";
import { hexBytes, mls } from "../../mls.ts";
import { newKennitala, signIn } from "../../oidc.ts";
import { community, errorOf, ok, person, platformModerator, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import { recorder, run, type Page } from "../notifications/support.ts";

// A suspended account (decision 0115): what it may not do, from one table, each
// path refused while suspended and allowed once it is not; what it still may;
// an end date that is read and never swept; the one review of it. An operation
// the contract gains that neither table names fails here, so that a new write
// path is decided on and not forgotten.

const BASE = "https://spjall.test";
const DAY = 24 * 60 * 60 * 1000;
const KNOWING = () => `android/${env.SUSPENSION_NOTICE_CLIENT_VERSION}`;
const DECODING = () => `android/${env.NOTICE_CLIENT_VERSION}`;
const OLD = "android/0.17.7";

/** A community with a member's post, comment and poll, and a person to invite. */
async function setting() {
  const [one, owner, author, outsider] = [
    await person("Sá sem er í banni"),
    await person("Eigandi"),
    await person("Höfundur"),
    await person("Utan hóps"),
  ];
  const id = await community(owner, "open", one, author);
  const elsewhere = await community(owner, "open");
  // Only a moderator invites, so the account being refused holds a community of its own.
  const owned = await community(one, "open");
  const { postId } = await ok<{ postId: string }>(
    await author.call("POST", `/v1/communities/${id}/posts`, { body: "Innlegg" }),
  );
  const { commentId } = await ok<{ commentId: string }>(
    await author.call("POST", `/v1/posts/${postId}/comments`, {
      body: "Athugasemd",
      parentCommentId: null,
    }),
  );
  const poll = await ok<{ postId: string; poll: { options: { optionId: string }[] } }>(
    await author.call("POST", `/v1/communities/${id}/posts`, {
      body: "Spurning",
      media: [],
      poll: { options: ["Já", "Nei"] },
    }),
  );
  const wallPost = await ok<{ postId: string }>(
    await one.call("POST", "/v1/wall/posts", { body: "Á veggnum" }),
  );
  return { one, owner, author, outsider, id, elsewhere, owned, postId, commentId, poll, wallPost };
}
type Setting = Awaited<ReturnType<typeof setting>>;

const putCover = async (by: Person) =>
  worker.fetch(`${BASE}/v1/wall/cover`, {
    method: "PUT",
    headers: { ...by.auth, "content-type": "application/octet-stream" },
    body: await png(1600, 600),
  });

/**
 * Every path a suspended account is refused, by the contract's operation id.
 * The one check is `notSuspended` (`backend/src/identity/suspension.ts`), and
 * no route has a predicate of its own, so this table is the whole list.
 */
const REFUSED: Record<string, { allowed: number; call: (s: Setting) => Promise<Response> }> = {
  sendFriendRequest: {
    allowed: 200,
    call: (s) => s.one.call("PUT", `/v1/friend-requests/${s.outsider.accountId}`),
  },
  createPost: {
    allowed: 200,
    call: (s) => s.one.call("POST", `/v1/communities/${s.id}/posts`, { body: "Nýtt" }),
  },
  uploadSocialMedia: {
    allowed: 200,
    call: async (s) => s.one.send(`/v1/communities/${s.id}/media`, await png(40, 20)),
  },
  createComment: {
    allowed: 200,
    call: (s) =>
      s.one.call("POST", `/v1/posts/${s.postId}/comments`, { body: "Svar", parentCommentId: null }),
  },
  react: {
    allowed: 204,
    call: (s) => s.one.call("PUT", `/v1/posts/${s.postId}/reaction`, { kind: "love" }),
  },
  likeComment: {
    allowed: 204,
    call: (s) => s.one.call("PUT", `/v1/comments/${s.commentId}/like`),
  },
  votePoll: {
    allowed: 200,
    call: (s) =>
      s.one.call("PUT", `/v1/posts/${s.poll.postId}/vote`, {
        optionId: s.poll.poll.options[0]!.optionId,
      }),
  },
  createCommunity: {
    allowed: 200,
    call: (s) => s.one.call("POST", "/v1/communities", { name: "Nýr hópur", audience: "open" }),
  },
  joinCommunity: {
    allowed: 200,
    call: (s) => s.one.call("POST", `/v1/communities/${s.elsewhere}/join`),
  },
  inviteToCommunity: {
    allowed: 204,
    call: (s) =>
      s.one.call("PUT", `/v1/communities/${s.owned}/invitations/${s.outsider.accountId}`),
  },
  createWallPost: {
    allowed: 200,
    call: (s) => s.one.call("POST", "/v1/wall/posts", { body: "Nýtt", audience: "friends" }),
  },
  uploadWallMedia: {
    allowed: 200,
    call: async (s) => s.one.send("/v1/wall/media", await png(40, 20)),
  },
  setPostAudience: {
    allowed: 204,
    call: (s) =>
      s.one.call("PATCH", `/v1/posts/${s.wallPost.postId}/audience`, { audience: "everyone" }),
  },
  setBio: {
    allowed: 204,
    call: (s) => s.one.call("PUT", "/v1/me/bio", { bio: "Smiður" }),
  },
  setWallCover: {
    allowed: 200,
    call: (s) => putCover(s.one),
  },
  frameWallCover: {
    allowed: 200,
    call: async (s) => {
      // Refused like the frames while suspended; the frames need a cover after.
      await putCover(s.one);
      return s.one.call("PATCH", "/v1/wall/cover/frames", { focus: { x: 0.2, y: 0.8 } });
    },
  },
};

/**
 * Every other write in the contract, which a suspension does not touch, each
 * group with why. The behaviour of the ones the decision names is tested below.
 */
const NOT_REFUSED: Record<string, readonly string[]> = {
  // Saying no, ending and keeping away are a person's own safety, and an accept
  // only answers someone who asked (decision 0114).
  friends: [
    "acceptFriendRequest",
    "declineFriendRequest",
    "cancelFriendRequest",
    "endFriendship",
    "snoozePerson",
    "unsnoozePerson",
  ],
  // Signing in, and all that keeps an account's devices and sessions its own.
  account: [
    "registerDevice",
    "linkIdentity",
    "deleteAccount",
    "revokeDevice",
    "setPushToken",
    "clearPushToken",
    "uploadKeyPackages",
    "claimKeyPackages",
    "rotateInvite",
    "revokeInvite",
    "endSession",
    "endOtherSessions",
    "createDeviceLinkRequest",
    "approveDeviceLinkRequest",
    "completeDeviceLinkRequest",
    "createHistoryTransfer",
    "deleteHistory",
    "putHistoryPart",
    "completeHistoryTransfer",
    "setPhoto",
    "removePhoto",
    "setPhotoFrames",
  ],
  // A conversation is end-to-end encrypted, and a person may need it.
  conversation: [
    "sendMessage",
    "createConversation",
    "leaveConversation",
    "muteConversation",
    "unmuteConversation",
    "putGroupPhoto",
    "deleteGroupPhoto",
    "putMedia",
  ],
  // Taking something back: what the account already did may always be undone.
  takingBack: [
    "deletePost",
    "deleteComment",
    "unreact",
    "withdrawVote",
    "unlikeComment",
    "withdrawJoinRequest",
    "leaveCommunity",
    "closePoll",
    "removeWallCover",
  ],
  // Protecting oneself, and answering the decision.
  recourse: ["blockAccount", "unblockAccount", "report", "askModerationReview"],
  // Moderating where the account already moderates, and the platform's own.
  moderating: [
    "updateCommunity",
    "deleteCommunity",
    "restoreCommunity",
    "approveJoinRequest",
    "declineJoinRequest",
    "setCommunityRole",
    "transferCommunity",
    "setCommunityAvatar",
    "removeCommunityAvatar",
    "setCommunityCover",
    "removeCommunityCover",
    "setCommunityAvatarFrames",
    "setCommunityCoverFrames",
    "approveAnonymousPost",
    "declineAnonymousPost",
    "revealAuthor",
    "pinPost",
    "unpinPost",
    "closeReport",
    "moderate",
    "moderatePlatform",
    "decideModerationReview",
    "removeWallComment",
  ],
  // The account's own reading: what it has seen, and how it is told.
  reading: [
    "pinCommunity",
    "unpinCommunity",
    "resolveCards",
    "readNotifications",
    "seenNotifications",
    "deleteNotification",
    "putNotificationSettings",
    "setCommunityNotificationLevel",
  ],
};

const act = (by: Person, action: string, targetId: string, more: Record<string, unknown> = {}) =>
  by.call("POST", "/v1/moderation/actions", { action, targetId, reason: "Ástæðan", ...more });

const suspend = async (by: Person, one: Person, until?: number) =>
  expect(
    (await act(by, "suspend_account", one.accountId, until === undefined ? {} : { until })).status,
  ).toBe(204);

const unsuspend = async (by: Person, one: Person) =>
  expect((await act(by, "unsuspend_account", one.accountId)).status).toBe(204);

type Me = { suspension: { until: number | null } | null; platformModerator: boolean };
const meOf = async (one: Person) => ok<Me>(await one.call("GET", "/v1/me"));

const expectRefused = async (response: Response, until?: number) => {
  expect(response.status).toBe(403);
  const body = (await response.json()) as { error: string; until?: number };
  expect(body.error).toBe("suspended");
  expect(body.until).toBe(until);
};

type Statement = {
  entryId: number;
  action: string;
  reason: string;
  until: number | null;
  canAsk: boolean;
  review: { state: string; restored: boolean } | null;
};
const statements = async (one: Person) =>
  (await ok<{ statements: Statement[] }>(await one.call("GET", "/v1/moderation/statements")))
    .statements;
const ask = (one: Person, entryId: number) =>
  one.call("POST", `/v1/moderation/statements/${entryId}/review`);
const decide = (by: Person, entryId: number, outcome: string) =>
  by.call("POST", `/v1/moderation/reviews/${entryId}`, { outcome, reason: "Svarið" });

const logged = async (targetId: string) =>
  (
    await env.DB.prepare("SELECT action FROM moderation_log WHERE target_id = ? ORDER BY entry_id")
      .bind(targetId)
      .all<{ action: string }>()
  ).results.map((r) => r.action);

const inboxAs = async (one: Person, client: string) => {
  // One run takes a batch, and the file's earlier tests left jobs of their own.
  while ((await run(recorder())).done > 0);
  return ok<Page>(
    await worker.fetch(`${BASE}/v1/notifications`, {
      headers: { ...one.auth, [CLIENT_HEADER]: client },
    }),
  );
};

describe("what a suspended account is refused (decision 0115)", () => {
  for (const [operation, { allowed, call }] of Object.entries(REFUSED)) {
    it(`refuses ${operation}, and allows it to anyone not suspended`, async () => {
      const platform = await platformModerator("Samtak");
      const s = await setting();
      await suspend(platform, s.one);
      await expectRefused(await call(s));
      await unsuspend(platform, s.one);
      expect((await call(s)).status).toBe(allowed);
    });
  }

  it("says when it ends, when it does", async () => {
    const platform = await platformModerator("Samtak");
    const s = await setting();
    const until = Date.now() + DAY;
    await suspend(platform, s.one, until);
    await expectRefused(await REFUSED["createPost"]!.call(s), until);
  });

  it("names every write in the contract in one table or the other", () => {
    const document = createApp().getOpenAPIDocument(DOCUMENT_INFO);
    const writes = Object.values(document.paths ?? {}).flatMap((path) =>
      Object.entries(path as Record<string, { operationId?: string }>)
        .filter(([method]) => ["post", "put", "patch", "delete"].includes(method))
        .map(([, operation]) => operation.operationId),
    );
    const named = [...Object.keys(REFUSED), ...Object.values(NOT_REFUSED).flat()];
    expect(writes.toSorted()).toEqual(named.toSorted());
  });

  it("declares its refusal on every refused path", () => {
    const document = createApp().getOpenAPIDocument(DOCUMENT_INFO);
    const operations = Object.values(document.paths ?? {}).flatMap((path) =>
      Object.values(
        path as Record<
          string,
          { operationId?: string; responses?: Record<string, { description?: string }> }
        >,
      ),
    );
    for (const operation of Object.keys(REFUSED)) {
      const found = operations.find((o) => o.operationId === operation);
      expect(found?.responses?.["403"]?.description, operation).toContain("suspended");
    }
  });
});

describe("what a suspended account still does (decision 0115)", () => {
  it("sends and reads messages in a conversation", async () => {
    const platform = await platformModerator("Samtak");
    const [a, b] = [await person("Einn"), await person("Annar")];
    await suspend(platform, a);
    const conversation = base64url(hexBytes(mls.messages[0]!.groupId));
    expect(
      (await a.call("POST", "/v1/conversations", { conversationId: conversation })).status,
    ).toBe(200);
    const sent = await a.call("POST", `/v1/conversations/${conversation}/messages`, {
      clientMsgId: "add_b",
      ciphertext: mls.claimed("add b", [a.accountId, b.accountId], [b.accountId]),
      welcome: { message: mls.welcomeBase64 },
      groupInfo: mls.groupInfo("add b"),
    });
    expect(sent.status).toBe(200);
    expect((await b.call("GET", `/v1/conversations/${conversation}/messages?after=0`)).status).toBe(
      200,
    );
    expect((await a.call("GET", `/v1/conversations/${conversation}/messages?after=0`)).status).toBe(
      200,
    );
  });

  it("reads, and its posts stay where others read them", async () => {
    const platform = await platformModerator("Samtak");
    const s = await setting();
    const { postId } = await ok<{ postId: string }>(
      await s.one.call("POST", `/v1/communities/${s.id}/posts`, { body: "Áður en bannið" }),
    );
    await suspend(platform, s.one);
    for (const path of ["/v1/feed", `/v1/communities/${s.id}/posts`, `/v1/posts/${s.postId}`]) {
      expect((await s.one.call("GET", path)).status, path).toBe(200);
    }
    expect(
      await ok<{ body: string }>(await s.author.call("GET", `/v1/posts/${postId}`)),
    ).toMatchObject({ body: "Áður en bannið" });
  });

  it("deletes its own post and comment, and leaves a community", async () => {
    const platform = await platformModerator("Samtak");
    const s = await setting();
    const { postId } = await ok<{ postId: string }>(
      await s.one.call("POST", `/v1/communities/${s.id}/posts`, { body: "Mitt" }),
    );
    const { commentId } = await ok<{ commentId: string }>(
      await s.one.call("POST", `/v1/posts/${s.postId}/comments`, {
        body: "Mín",
        parentCommentId: null,
      }),
    );
    await suspend(platform, s.one);
    expect((await s.one.call("DELETE", `/v1/comments/${commentId}`)).status).toBe(204);
    expect((await s.one.call("DELETE", `/v1/posts/${postId}`)).status).toBe(204);
    expect((await s.one.call("POST", `/v1/communities/${s.id}/leave`)).status).toBe(204);
  });

  it("removes a comment on its own wall, and takes its cover down", async () => {
    const platform = await platformModerator("Samtak");
    const s = await setting();
    await s.one.call("PATCH", `/v1/posts/${s.wallPost.postId}/audience`, { audience: "everyone" });
    expect((await putCover(s.one)).status).toBe(200);
    const { commentId } = await ok<{ commentId: string }>(
      await s.outsider.call("POST", `/v1/posts/${s.wallPost.postId}/comments`, { body: "Bull" }),
    );
    await suspend(platform, s.one);
    expect(
      (await s.one.call("POST", `/v1/wall/comments/${commentId}/remove`, { reason: "Bull" }))
        .status,
    ).toBe(204);
    expect((await s.one.call("DELETE", "/v1/wall/cover")).status).toBe(204);
  });

  it("takes back a reaction and a vote it gave before", async () => {
    const platform = await platformModerator("Samtak");
    const s = await setting();
    expect((await REFUSED["react"]!.call(s)).status).toBe(204);
    expect((await REFUSED["votePoll"]!.call(s)).status).toBe(200);
    await suspend(platform, s.one);
    expect((await s.one.call("DELETE", `/v1/posts/${s.postId}/reaction`)).status).toBe(204);
    expect((await s.one.call("DELETE", `/v1/posts/${s.poll.postId}/vote`)).status).toBe(200);
  });

  it("blocks and reports", async () => {
    const platform = await platformModerator("Samtak");
    const s = await setting();
    await suspend(platform, s.one);
    expect((await s.one.call("PUT", `/v1/blocks/${s.outsider.accountId}`)).status).toBe(204);
    const reported = await s.one.call("POST", "/v1/reports", {
      target: { kind: "post", id: s.postId },
      reason: "other",
    });
    expect(reported.status).toBe(204);
  });

  it("signs in", async () => {
    const platform = await platformModerator("Samtak");
    const kennitala = newKennitala();
    const first = await ok<{ accountId: string }>(await signIn({ kennitala }));
    expect((await act(platform, "suspend_account", first.accountId)).status).toBe(204);
    const again = await ok<{ accountId: string }>(await signIn({ kennitala }));
    expect(again.accountId).toBe(first.accountId);
  });

  it("deletes its account, and the log entry stays with no name on it", async () => {
    const platform = await platformModerator("Samtak");
    const one = await person("Fer");
    await suspend(platform, one);
    expect((await one.call("DELETE", "/v1/me")).status).toBe(204);
    await deleteOrphans(euEnv(env));
    const entry = await env.DB.prepare(
      "SELECT action, target_account, reason FROM moderation_log WHERE target_id = ?",
    )
      .bind(one.accountId)
      .first<{ action: string; target_account: string | null; reason: string }>();
    expect(entry).toEqual({ action: "suspend_account", target_account: null, reason: "Ástæðan" });
  });

  it("moderates in a community it already moderates", async () => {
    const platform = await platformModerator("Samtak");
    const s = await setting();
    await s.owner.call("PUT", `/v1/communities/${s.id}/members/${s.one.accountId}/role`, {
      role: "moderator",
    });
    await suspend(platform, s.one);
    const hidden = await s.one.call("POST", `/v1/communities/${s.id}/actions`, {
      action: "hide_post",
      targetId: s.postId,
      reason: "Ástæðan",
    });
    expect(hidden.status).toBe(204);
  });
});

describe("the end of a suspension (decision 0115)", () => {
  it("is read: once it has passed nothing refuses, and no job ran", async () => {
    const platform = await platformModerator("Samtak");
    const s = await setting();
    await suspend(platform, s.one, Date.now() + DAY);
    expect((await meOf(s.one)).suspension).toMatchObject({ until: expect.any(Number) as number });
    await env.DB.prepare("UPDATE accounts SET suspended_until = ? WHERE account_id = ?")
      .bind(Date.now() - 1, s.one.accountId)
      .run();
    expect((await meOf(s.one)).suspension).toBeNull();
    expect((await REFUSED["createPost"]!.call(s)).status).toBe(200);
  });

  it("is replaced by a newer decision, which is logged: the latest decides", async () => {
    const platform = await platformModerator("Samtak");
    const s = await setting();
    await suspend(platform, s.one, Date.now() + DAY);
    await suspend(platform, s.one);
    expect((await meOf(s.one)).suspension).toEqual({ until: null });
    const later = Date.now() + 2 * DAY;
    await suspend(platform, s.one, later);
    expect((await meOf(s.one)).suspension).toEqual({ until: later });
    expect(await logged(s.one.accountId)).toEqual([
      "suspend_account",
      "suspend_account",
      "suspend_account",
    ]);
  });

  it("refuses an end that has passed, and one on any other action", async () => {
    const platform = await platformModerator("Samtak");
    const one = await person("Einn");
    expect(
      (await act(platform, "suspend_account", one.accountId, { until: Date.now() - 1 })).status,
    ).toBe(400);
    await suspend(platform, one);
    expect(
      (await act(platform, "unsuspend_account", one.accountId, { until: Date.now() + DAY })).status,
    ).toBe(400);
    expect((await meOf(one)).suspension).toEqual({ until: null });
  });
});

describe("who may suspend (decision 0115)", () => {
  it("is a platform moderator, and nobody else", async () => {
    const s = await setting();
    await s.owner.call("PUT", `/v1/communities/${s.id}/members/${s.author.accountId}/role`, {
      role: "moderator",
    });
    for (const one of [s.owner, s.author, s.outsider]) {
      const refused = await act(one, "suspend_account", s.one.accountId);
      expect(refused.status).toBe(403);
      expect(await errorOf(refused)).toBe("not_permitted");
    }
    expect((await meOf(s.one)).suspension).toBeNull();
    expect(await logged(s.one.accountId)).toEqual([]);
  });

  it("is never one's self, nor a colleague", async () => {
    const platform = await platformModerator("Samtak");
    const colleague = await platformModerator("Annar");
    expect((await act(platform, "suspend_account", platform.accountId)).status).toBe(403);
    expect((await act(platform, "suspend_account", colleague.accountId)).status).toBe(403);
    expect((await meOf(platform)).suspension).toBeNull();
  });

  it("needs a reason, and an account that is there to unsuspend", async () => {
    const platform = await platformModerator("Samtak");
    const one = await person("Einn");
    expect((await act(platform, "suspend_account", one.accountId, { reason: "" })).status).toBe(
      400,
    );
    expect((await act(platform, "unsuspend_account", one.accountId)).status).toBe(404);
    expect((await act(platform, "suspend_account", "acct_none")).status).toBe(404);
    expect(await logged(one.accountId)).toEqual([]);
  });

  it("closes the report it answers, and writes the reason nowhere but the log", async () => {
    const platform = await platformModerator("Samtak");
    const one = await person("Einn");
    const reporter = await person("Tilkynnandi");
    await reporter.call("POST", "/v1/reports", {
      target: { kind: "account", id: one.accountId },
      reason: "other",
    });
    const { reports } = await ok<{ reports: { reportId: string; target: { id: string } }[] }>(
      await platform.call("GET", "/v1/moderation/reports"),
    );
    const reportId = reports.find((r) => r.target.id === one.accountId)!.reportId;
    expect((await act(platform, "suspend_account", one.accountId, { reportId })).status).toBe(204);
    const closed = await ok<{ reports: { reportId: string; decision: string | null }[] }>(
      await platform.call("GET", "/v1/moderation/reports?state=closed"),
    );
    expect(closed.reports.find((r) => r.reportId === reportId)?.decision).toBe("suspend_account");
    const columns = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('accounts') WHERE name LIKE 'suspen%' ORDER BY name",
    ).all<{ name: string }>();
    expect(columns.results.map((c) => c.name)).toEqual(["suspended_at", "suspended_until"]);
  });
});

describe("the notice of a suspension (decision 0115)", () => {
  it("tells the person, and is withheld from a client that cannot decode it", async () => {
    const platform = await platformModerator("Samtak");
    const one = await person("Einn");
    await suspend(platform, one);
    await unsuspend(platform, one);

    const knowing = await inboxAs(one, KNOWING());
    expect(knowing.notifications.map((n) => [n.kind, n.communityId, n.action]).toSorted()).toEqual([
      ["moderated", null, "suspend_account"],
      ["moderated", null, "unsuspend_account"],
    ]);
    const old = await inboxAs(one, OLD);
    expect(old.notifications).toEqual([]);
    expect([old.unread, old.unseen]).toEqual([0, 0]);
  });

  it("is withheld from a client that decodes it but would word it as a removal", async () => {
    const platform = await platformModerator("Samtak");
    const one = await person("Einn");
    await suspend(platform, one);
    const decoding = await inboxAs(one, DECODING());
    expect(decoding.notifications).toEqual([]);
    expect([decoding.unread, decoding.unseen]).toEqual([0, 0]);
  });
});

describe("how long a suspension was for (decision 0115)", () => {
  it("is on the statement, in the log and on the review card, and null with no end date", async () => {
    const [platform, second] = [
      await platformModerator("Samtak"),
      await platformModerator("Önnur"),
    ];
    const [timed, open] = [await person("Tímabundið"), await person("Ótímabundið")];
    const until = Date.now() + 7 * DAY;
    await suspend(platform, timed, until);
    await suspend(platform, open);

    const [timedStatement] = await statements(timed);
    const [openStatement] = await statements(open);
    if (!timedStatement || !openStatement) throw new Error("no statement");
    expect([timedStatement.until, openStatement.until]).toEqual([until, null]);

    const { entries } = await ok<{ entries: { target: { id: string }; until: number | null }[] }>(
      await platform.call("GET", "/v1/moderation/log"),
    );
    const inLog = (one: Person) => entries.find((e) => e.target.id === one.accountId)?.until;
    expect([inLog(timed), inLog(open)]).toEqual([until, null]);

    for (const [one, statement] of [
      [timed, timedStatement],
      [open, openStatement],
    ] as const) {
      expect((await ask(one, statement.entryId)).status).toBe(204);
    }
    const { reviews } = await ok<{ reviews: { entryId: number; until: number | null }[] }>(
      await second.call("GET", "/v1/moderation/reviews"),
    );
    const onCard = (s: { entryId: number }) => reviews.find((r) => r.entryId === s.entryId)?.until;
    expect([onCard(timedStatement), onCard(openStatement)]).toEqual([until, null]);
  });

  it("stays as decided after the account's own columns move on", async () => {
    const platform = await platformModerator("Samtak");
    const one = await person("Einn");
    const [first, later] = [Date.now() + DAY, Date.now() + 9 * DAY];
    await suspend(platform, one, first);
    await suspend(platform, one, later);
    await unsuspend(platform, one);
    expect((await statements(one)).map((s) => [s.action, s.until])).toEqual([
      ["suspend_account", later],
      ["suspend_account", first],
    ]);
  });
});

describe("the one review of a suspension (decision 0115)", () => {
  /** An account suspended by `actor`, with the entry of the statement it reads. */
  async function suspended() {
    const [actor, second] = [await platformModerator("Samtak"), await platformModerator("Önnur")];
    const s = await setting();
    await suspend(actor, s.one);
    const [statement] = await statements(s.one);
    expect(statement).toMatchObject({
      action: "suspend_account",
      reason: "Ástæðan",
      canAsk: true,
      review: null,
    });
    return { actor, second, s, entryId: statement!.entryId };
  }

  it("is asked once, and an overturn lifts the suspension and tells the person", async () => {
    const { second, s, entryId } = await suspended();
    expect((await ask(s.one, entryId)).status).toBe(204);
    const refused = await ask(s.one, entryId);
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe("already_asked");

    expect((await decide(second, entryId, "overturned")).status).toBe(204);
    expect((await meOf(s.one)).suspension).toBeNull();
    expect((await REFUSED["createPost"]!.call(s)).status).toBe(200);
    const [statement] = await statements(s.one);
    expect(statement?.review).toMatchObject({ state: "overturned", restored: true });
    expect(await logged(s.one.accountId)).toEqual([
      "suspend_account",
      "review_overturned",
      "unsuspend_account",
    ]);
    const { notifications } = await inboxAs(s.one, KNOWING());
    expect(notifications.map((n) => n.action)).toContain("review_overturned");
  });

  it("upheld, lifts nothing", async () => {
    const { second, s, entryId } = await suspended();
    await ask(s.one, entryId);
    expect((await decide(second, entryId, "upheld")).status).toBe(204);
    expect((await meOf(s.one)).suspension).toEqual({ until: null });
    expect((await statements(s.one))[0]?.review).toMatchObject({
      state: "upheld",
      restored: false,
    });
  });

  it("overturned, lifts nothing while a later suspension stands, and says so", async () => {
    const { actor, second, s, entryId } = await suspended();
    await ask(s.one, entryId);
    const until = Date.now() + DAY;
    await suspend(actor, s.one, until);
    expect((await decide(second, entryId, "overturned")).status).toBe(204);
    expect((await meOf(s.one)).suspension).toEqual({ until });
    const statement = (await statements(s.one)).find((e) => e.entryId === entryId);
    expect(statement?.review).toMatchObject({ state: "overturned", restored: false });
    expect(await logged(s.one.accountId)).toEqual([
      "suspend_account",
      "suspend_account",
      "review_overturned",
    ]);
    await expectRefused(await REFUSED["createPost"]!.call(s), until);
  });

  it("is not decided by the one who acted", async () => {
    const { actor, second, s, entryId } = await suspended();
    await ask(s.one, entryId);
    const refused = await decide(actor, entryId, "overturned");
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_permitted");
    expect((await meOf(s.one)).suspension).toEqual({ until: null });
    expect((await decide(second, entryId, "overturned")).status).toBe(204);
  });

  it("is what an entry of an unsuspension never is", async () => {
    const { actor, s } = await suspended();
    await unsuspend(actor, s.one);
    expect((await statements(s.one)).map((e) => e.action)).toEqual(["suspend_account"]);
  });
});

describe("what /v1/me says (decision 0115)", () => {
  it("names a suspension, and who is a platform moderator", async () => {
    const platform = await platformModerator("Samtak");
    const one = await person("Einn");
    expect(await meOf(one)).toMatchObject({ suspension: null, platformModerator: false });
    expect(await meOf(platform)).toMatchObject({ suspension: null, platformModerator: true });
    await suspend(platform, one);
    expect(await meOf(one)).toMatchObject({ suspension: { until: null } });
  });
});
