import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { base64url } from "../src/bytes.ts";
import { device } from "./support.ts";
import { hexBytes, mls } from "./mls.ts";

// Conversations over HTTP with real OpenMLS messages (api/fixtures/
// mls-framing.json): the Worker reads their framing, the DO keeps them.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => exports.default.fetch(`${BASE}${path}`, init);
const post = (path: string, body: unknown, auth: Record<string, string>) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify(body),
  });
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

/** The fixture conversation's id: its group id as unpadded base64url. */
const CONVERSATION = base64url(hexBytes(mls.messages[0]!.groupId));
const MESSAGES = `/v1/conversations/${CONVERSATION}/messages`;
const GROUP_INFO = `/v1/conversations/${CONVERSATION}/group-info`;

describe("a conversation over HTTP", () => {
  let a: Awaited<ReturnType<typeof device>>;
  let b: Awaited<ReturnType<typeof device>>;
  let outsider: Awaited<ReturnType<typeof device>>;

  beforeAll(async () => {
    [a, b, outsider] = [await device(), await device(), await device()];
  });

  it("carries the scripted conversation from creation to a lost commit", async () => {
    const create = await post("/v1/conversations", { conversationId: CONVERSATION }, a.auth);
    expect(create.status).toBe(200);
    expect(await create.json()).toEqual({ conversationId: CONVERSATION });
    expect((await post("/v1/conversations", { conversationId: CONVERSATION }, a.auth)).status).toBe(
      200,
    );
    const taken = await post("/v1/conversations", { conversationId: CONVERSATION }, b.auth);
    expect(taken.status).toBe(409);
    expect(await errorOf(taken)).toBe("conversation_exists");

    // B is not in it yet.
    expect((await fetch(`${MESSAGES}?after=0`, { headers: b.auth })).status).toBe(403);

    const add = await post(
      MESSAGES,
      {
        clientMsgId: "add_b",
        ciphertext: mls.claimed("add b", [a.accountId, b.accountId], [b.accountId]),
        welcome: { message: mls.welcomeBase64 },
        groupInfo: mls.groupInfo("add b"),
      },
      a.auth,
    );
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({ seq: 1 });

    const welcome = await fetch(`/v1/conversations/${CONVERSATION}/welcome`, { headers: b.auth });
    expect(await welcome.json()).toEqual({ seq: 1, welcome: mls.welcomeBase64 });

    for (const [name, sender, seq, ciphertext, extra] of [
      ["a to b", a, 2, mls.base64("a to b"), {}],
      ["b to a", b, 3, mls.base64("b to a"), {}],
      ["b proposes", b, 4, mls.base64("b proposes"), {}],
      [
        "a updates",
        a,
        5,
        mls.claimed("a updates", [a.accountId, b.accountId]),
        { groupInfo: mls.groupInfo("a updates") },
      ],
    ] as const) {
      const sent = await post(
        MESSAGES,
        { clientMsgId: name.replaceAll(" ", "_"), ciphertext, ...extra },
        sender.auth,
      );
      expect(await sent.json(), name).toEqual({ seq });
    }

    // B committed on epoch 1 too, and lost.
    const lost = await post(
      MESSAGES,
      {
        clientMsgId: "b_updates",
        ciphertext: mls.claimed("b updates", [b.accountId]),
        groupInfo: mls.groupInfo("b updates"),
      },
      b.auth,
    );
    expect(lost.status).toBe(409);
    expect(await errorOf(lost)).toBe("epoch_conflict");

    const page = await fetch(`${MESSAGES}?after=1&limit=2`, { headers: a.auth });
    expect(await page.json()).toEqual({
      messages: [
        { seq: 2, ciphertext: mls.base64("a to b") },
        { seq: 3, ciphertext: mls.base64("b to a") },
      ],
      more: true,
    });

    const outside = await fetch(`${MESSAGES}?after=0`, { headers: outsider.auth });
    expect(outside.status).toBe(403);
    expect(await errorOf(outside)).toBe("not_a_member");

    // The winning commit's GroupInfo is the one a new device joins from.
    const info = await fetch(GROUP_INFO, { headers: b.auth });
    expect(await info.json()).toEqual({ seq: 5, groupInfo: mls.groupInfo("a updates") });
    const outsiderInfo = await fetch(GROUP_INFO, { headers: outsider.auth });
    expect(outsiderInfo.status).toBe(403);
  });

  it("lets a new device of a member account join by an external commit (0021)", async () => {
    // The conversation is on epoch 2 now: "add b" took 0, "a updates" 1.
    const a2 = await device({ accountId: a.accountId });
    const roster = [a.accountId, b.accountId];
    const own = { identity: `${a.accountId}/${a2.deviceId}`, signatureKey: a2.deviceKey };
    const join = (clientMsgId: string, ciphertext: string, epoch = 2) => ({
      clientMsgId,
      ciphertext,
      groupInfo: mls.groupInfo("a5 joins", epoch + 1),
    });

    for (const [clientMsgId, leaf] of [
      ["other_device", { ...own, identity: `${a.accountId}/${a.deviceId}` }],
      ["other_key", { ...own, signatureKey: a.deviceKey }],
    ] as const) {
      const response = await post(
        MESSAGES,
        join(clientMsgId, mls.joining(roster, { epoch: 2, ...leaf })),
        a2.auth,
      );
      expect(response.status, clientMsgId).toBe(400);
      expect(await errorOf(response)).toBe("invalid_request");
    }

    // A join that changes the roster is refused; one on an old epoch hears so.
    const dropsB = await post(
      MESSAGES,
      join("drops_b", mls.joining([a.accountId], { epoch: 2, ...own })),
      a2.auth,
    );
    expect(dropsB.status).toBe(400);
    const stale = await post(
      MESSAGES,
      join("stale", mls.joining([...roster, outsider.accountId], { epoch: 1, ...own }), 1),
      a2.auth,
    );
    expect(stale.status).toBe(409);
    expect(await errorOf(stale)).toBe("epoch_conflict");

    const joined = await post(
      MESSAGES,
      join("joins", mls.joining(roster, { epoch: 2, ...own })),
      a2.auth,
    );
    expect(await joined.json()).toEqual({ seq: 6 });
    const info = await fetch(GROUP_INFO, { headers: a2.auth });
    expect(await info.json()).toEqual({ seq: 6, groupInfo: mls.groupInfo("a5 joins", 3) });

    // A device of an account outside the roster cannot join.
    const leaf = {
      identity: `${outsider.accountId}/${outsider.deviceId}`,
      signatureKey: outsider.deviceKey,
    };
    const outside = await post(
      MESSAGES,
      join("outside", mls.joining([...roster, outsider.accountId], { epoch: 3, ...leaf }), 3),
      outsider.auth,
    );
    expect(outside.status).toBe(403);
    expect(await errorOf(outside)).toBe("not_a_member");
  });

  it("refuses a commit without the GroupInfo of its group's next epoch, and one elsewhere", async () => {
    const ciphertext = mls.claimed("a updates", [a.accountId, b.accountId]);
    for (const [clientMsgId, body] of [
      ["no_info", { ciphertext }],
      ["same_epoch", { ciphertext, groupInfo: mls.groupInfo("add b") }],
      ["other_group", { ciphertext, groupInfo: mls.groupInfo("public add", 2) }],
      ["not_info", { ciphertext, groupInfo: mls.welcomeBase64 }],
      ["app_info", { ciphertext: mls.base64("a to b"), groupInfo: mls.groupInfo("a updates") }],
    ] as const) {
      const response = await post(MESSAGES, { clientMsgId, ...body }, a.auth);
      expect(response.status, clientMsgId).toBe(400);
      expect(await errorOf(response)).toBe("invalid_request");
    }
  });

  it("refuses a message of another group", async () => {
    const response = await post(
      MESSAGES,
      { clientMsgId: "other", ciphertext: mls.base64("public add") },
      a.auth,
    );
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("group_mismatch");
  });

  it("refuses a Welcome on a message that is not a commit", async () => {
    const response = await post(
      MESSAGES,
      {
        clientMsgId: "app",
        ciphertext: mls.base64("a to b"),
        welcome: { message: mls.welcomeBase64 },
      },
      a.auth,
    );
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("invalid_request");
  });

  it("refuses a commit whose claim leaves out its sender or does not match its Welcome", async () => {
    const welcome = { message: mls.welcomeBase64 };
    for (const [clientMsgId, ciphertext, extra] of [
      // The fixture's own claim names accounts "a" and "b", not this sender.
      ["unclaimed", mls.base64("a updates"), {}],
      ["no_sender", mls.claimed("a updates", [b.accountId]), {}],
      ["no_welcome", mls.claimed("add b", [a.accountId, b.accountId], [b.accountId]), {}],
      ["no_one_for", mls.claimed("a updates", [a.accountId, b.accountId]), { welcome }],
    ] as const) {
      const groupInfo = mls.groupInfo(clientMsgId === "no_welcome" ? "add b" : "a updates");
      const body = { clientMsgId, ciphertext, groupInfo, ...extra };
      const response = await post(MESSAGES, body, a.auth);
      expect(response.status, clientMsgId).toBe(400);
      expect(await errorOf(response)).toBe("invalid_request");
    }
  });

  it("refuses bytes that are not an MLS message, and a Welcome that is not one", async () => {
    for (const body of [
      { clientMsgId: "junk", ciphertext: "AAEC" },
      { clientMsgId: "kp", ciphertext: mls.keyPackageBase64 },
      {
        clientMsgId: "bad_welcome",
        ciphertext: mls.claimed("add b", [a.accountId, b.accountId], [b.accountId]),
        welcome: { message: mls.base64("a to b") },
        groupInfo: mls.groupInfo("add b"),
      },
    ]) {
      const response = await post(MESSAGES, body, a.auth);
      expect(response.status, body.clientMsgId).toBe(400);
      expect(await errorOf(response)).toBe("invalid_request");
    }
  });

  it("answers 404 for a conversation nobody created", async () => {
    const response = await fetch("/v1/conversations/nobody/messages?after=0", { headers: a.auth });
    expect(response.status).toBe(404);
    const welcome = await fetch("/v1/conversations/nobody/welcome", { headers: a.auth });
    expect(welcome.status).toBe(404);
    const info = await fetch("/v1/conversations/nobody/group-info", { headers: a.auth });
    expect(info.status).toBe(404);
  });
});
