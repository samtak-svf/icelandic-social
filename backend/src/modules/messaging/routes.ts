import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  createConversationRoute,
  getConversationDevicesRoute,
  getGroupInfoRoute,
  getWelcomeRoute,
  leaveConversationRoute,
} from "../../api/conversations.ts";
import { getMediaRoute, putMediaRoute } from "../../api/media.ts";
import { listMessagesRoute, sendMessageRoute } from "../../api/messages.ts";
import { SOCKET_ACCOUNT, SOCKET_DEVICE, socketRoute } from "../../api/socket.ts";
import { toBase64 } from "../../shared/bytes.ts";
import { webSocketDevice } from "../../shared/credentials.ts";
import { conversation, inbox } from "../../env/index.ts";
import { fail } from "../../shared/errors.ts";
import type { AppEnv } from "../../http.ts";
import { activeDevicesOf, blockersAmong, ownsLeaf } from "../../identity/index.ts";
import { checkSend } from "./conversations.ts";
import { groupPhotoRoutes } from "./group-photo-routes.ts";
import { getMedia, MAX_CIPHERTEXT, putMedia } from "./media.ts";
import { muteRoutes } from "./mutes.ts";

/**
 * Everything messaging serves: conversations and their messages, muting
 * (decision 0042), a group's photo (0094), media (0023) and the socket.
 */
export function messagingRoutes(app: OpenAPIHono<AppEnv>): void {
  // Conversations (decisions 0015, 0017). The Worker reads the framing; the
  // Conversation DO decides membership, order and the epoch.
  app.openapi(sendMessageRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const checked = checkSend(c.var.device.accountId, conversationId, c.req.valid("json"));
    if ("error" in checked) return fail(c, 400, checked.error);
    // An external commit's leaf is the device joining: this one (0021).
    if (checked.joiner && !(await ownsLeaf(c.env, c.var.device, checked.joiner))) {
      return fail(c, 400, "invalid_request");
    }
    // A commit cannot bring in an account that has blocked its sender (0024):
    // the DO refuses a claim naming one that is not a member already.
    const { roster } = checked.ok;
    const blockedBy = roster && (await blockersAmong(c.env, c.var.device.accountId, roster));
    const result = await conversation(c.env, conversationId).send({
      ...checked.ok,
      ...(blockedBy?.length ? { blockedBy } : {}),
    });
    if ("ok" in result) return c.json(result.ok, 200);
    switch (result.error) {
      case "not_found":
        return fail(c, 404, result.error);
      case "not_a_member":
      case "blocked":
        return fail(c, 403, result.error);
      case "epoch_conflict":
      case "claim_names_departed":
        return fail(c, 409, result.error);
      default:
        return fail(c, 400, "invalid_request");
    }
  });

  app.openapi(listMessagesRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const { after, limit = 100 } = c.req.valid("query");
    const result = await conversation(c.env, conversationId).list(
      c.var.device.accountId,
      after,
      limit,
    );
    if ("error" in result) {
      return result.error === "not_found"
        ? fail(c, 404, result.error)
        : fail(c, 403, "not_a_member");
    }
    const messages = result.ok.messages.map((m) => ({
      seq: m.seq,
      ciphertext: toBase64(m.ciphertext),
      storedAt: m.storedAt,
    }));
    return c.json({ messages, more: result.ok.more }, 200);
  });

  app.openapi(createConversationRoute, async (c) => {
    const { conversationId } = c.req.valid("json");
    const result = await conversation(c.env, conversationId).create(
      c.var.device.accountId,
      conversationId,
    );
    return "ok" in result ? c.json({ conversationId }, 200) : fail(c, 409, "conversation_exists");
  });

  app.openapi(getWelcomeRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const result = await conversation(c.env, conversationId).welcome(c.var.device.accountId);
    if ("error" in result) {
      return result.error === "not_a_member"
        ? fail(c, 403, result.error)
        : fail(c, 404, "not_found");
    }
    return c.json({ seq: result.ok.seq, welcome: toBase64(result.ok.welcome) }, 200);
  });

  app.openapi(getGroupInfoRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const result = await conversation(c.env, conversationId).groupInfo(c.var.device.accountId);
    if ("error" in result) {
      return result.error === "not_a_member"
        ? fail(c, 403, result.error)
        : fail(c, 404, "not_found");
    }
    return c.json({ seq: result.ok.seq, groupInfo: toBase64(result.ok.groupInfo) }, 200);
  });

  app.openapi(getConversationDevicesRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const result = await conversation(c.env, conversationId).roster(c.var.device.accountId);
    if ("error" in result) {
      return result.error === "not_a_member"
        ? fail(c, 403, result.error)
        : fail(c, 404, "not_found");
    }
    return c.json({ accounts: await activeDevicesOf(c.env, result.ok) }, 200);
  });

  app.openapi(leaveConversationRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const result = await conversation(c.env, conversationId).leave(c.var.device.accountId);
    if ("error" in result) {
      return result.error === "not_a_member"
        ? fail(c, 403, result.error)
        : fail(c, 404, "not_found");
    }
    return c.body(null, 204);
  });

  muteRoutes(app);
  groupPhotoRoutes(app);

  // Media (decision 0023): the roster check is the Conversation DO's, as for messages.
  app.openapi(putMediaRoute, async (c) => {
    const { conversationId, mediaId } = c.req.valid("param");
    const body = c.req.raw.body;
    // A refusal cancels the body, so the client stops sending it.
    const refuse = async <T>(answer: T) => (await body?.cancel(), answer);
    const length = Number(c.req.header("content-length") ?? Number.NaN);
    if (!Number.isSafeInteger(length) || length < 1 || !body) {
      return refuse(fail(c, 400, "invalid_request"));
    }
    if (length > MAX_CIPHERTEXT) return refuse(fail(c, 413, "too_large"));
    const { accountId } = c.var.device;
    const member = await conversation(c.env, conversationId).member(accountId);
    if ("error" in member) {
      return member.error === "not_found"
        ? refuse(fail(c, 404, member.error))
        : refuse(fail(c, 403, "not_a_member"));
    }
    try {
      const stored = await putMedia(c.env, {
        mediaId,
        conversationId,
        accountId,
        size: length,
        body,
      });
      if (stored === "conflict") return refuse(fail(c, 409, "conflict"));
    } catch {
      // The body ended short of, or ran past, its Content-Length.
      return fail(c, 400, "invalid_request");
    }
    return c.body(null, 204);
  });

  app.openapi(getMediaRoute, async (c) => {
    const { conversationId, mediaId } = c.req.valid("param");
    const member = await conversation(c.env, conversationId).member(c.var.device.accountId);
    if ("error" in member) {
      return member.error === "not_found"
        ? fail(c, 404, member.error)
        : fail(c, 403, "not_a_member");
    }
    const object = await getMedia(c.env, conversationId, mediaId);
    if (!object) return fail(c, 404, "not_found");
    return c.body(object.body, 200, {
      "content-type": "application/octet-stream",
      "content-length": String(object.size),
    });
  });

  // The socket lives in the account's Inbox; the Worker tells it which
  // device this is, replacing any such header the client sent.
  app.openapi(socketRoute, async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return fail(c, 426, "upgrade_required");
    }
    const device = c.var.device ?? (await webSocketDevice(c));
    if (typeof device === "string") return fail(c, 403, device);
    const { accountId, deviceId } = device;
    const headers = new Headers(c.req.raw.headers);
    headers.set(SOCKET_ACCOUNT, accountId);
    headers.set(SOCKET_DEVICE, deviceId);
    return inbox(c.env, accountId).fetch(new Request(c.req.raw, { headers }));
  });
}
