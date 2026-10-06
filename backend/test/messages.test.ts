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
        ciphertext: mls.base64("add b"),
        roster: { add: [b.accountId] },
        welcome: { to: [b.accountId], message: mls.welcomeBase64 },
      },
      a.auth,
    );
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({ seq: 1 });

    const welcome = await fetch(`/v1/conversations/${CONVERSATION}/welcome`, { headers: b.auth });
    expect(await welcome.json()).toEqual({ seq: 1, welcome: mls.welcomeBase64 });

    for (const [name, sender, seq] of [
      ["a to b", a, 2],
      ["b to a", b, 3],
      ["b proposes", b, 4],
      ["a updates", a, 5],
    ] as const) {
      const sent = await post(
        MESSAGES,
        { clientMsgId: name.replaceAll(" ", "_"), ciphertext: mls.base64(name) },
        sender.auth,
      );
      expect(await sent.json(), name).toEqual({ seq });
    }

    // B committed on epoch 1 too, and lost.
    const lost = await post(
      MESSAGES,
      {
        clientMsgId: "b_updates",
        ciphertext: mls.base64("b updates"),
        roster: { remove: [a.accountId] },
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

  it("refuses a roster change or a Welcome on a message that is not a commit", async () => {
    for (const extra of [
      { roster: { add: [b.accountId] } },
      { welcome: { to: [b.accountId], message: mls.welcomeBase64 } },
    ]) {
      const response = await post(
        MESSAGES,
        { clientMsgId: "app", ciphertext: mls.base64("a to b"), ...extra },
        a.auth,
      );
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe("invalid_request");
    }
  });

  it("refuses bytes that are not an MLS message, and a Welcome that is not one", async () => {
    for (const body of [
      { clientMsgId: "junk", ciphertext: "AAEC" },
      { clientMsgId: "kp", ciphertext: mls.keyPackageBase64 },
      {
        clientMsgId: "bad_welcome",
        ciphertext: mls.base64("a updates"),
        welcome: { to: [b.accountId], message: mls.base64("a to b") },
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
  });
});
