import { OpenAPIHono } from "@hono/zod-openapi";
import { deleteAccount } from "./account-deletion.ts";
import { linkOrJoin } from "./account-linking.ts";
import { communityLifecycle } from "./community-lifecycle.ts";
import {
  createConversationRoute,
  getConversationDevicesRoute,
  getGroupInfoRoute,
  getWelcomeRoute,
  leaveConversationRoute,
} from "./api/conversations.ts";
import {
  clearPushTokenRoute,
  deleteAccountRoute,
  getMeRoute,
  linkIdentityRoute,
  registerDeviceRoute,
  revokeDeviceRoute,
  setPushTokenRoute,
  signInConfigRoute,
} from "./api/devices.ts";
import { WsFrame } from "./api/frames.ts";
import { FRAME_SPECS, SIZE_CLASSES } from "./api/image-frames.ts";
import { healthRoute } from "./api/health.ts";
import { claimKeyPackagesRoute, uploadKeyPackagesRoute } from "./api/key-packages.ts";
import { getMediaRoute, putMediaRoute } from "./api/media.ts";
import { listMessagesRoute, sendMessageRoute } from "./api/messages.ts";
import { SOCKET_ACCOUNT, SOCKET_DEVICE, socketRoute } from "./api/socket.ts";
import { fromBase64, toBase64 } from "./bytes.ts";
import { clientFloor } from "./client-version.ts";
import { guards, registerSchemes, webSocketDevice } from "./credentials.ts";
import { drainBody, fail, failed, requestId } from "./errors.ts";
import {
  conversation,
  identityProvider,
  inbox,
  minClientVersions,
  updateUrls,
  withinLimit,
} from "./env/index.ts";
import {
  activeDevicesOf,
  authorized,
  blockedByAny,
  blockersAmong,
  claim,
  clearPushToken,
  type Device,
  inviteRoutes,
  linkedDeviceRoutes,
  sessionRoutes,
  linkHost,
  me,
  ownsLeaf,
  registerDevice,
  revokeDevice,
  type Session,
  setPushToken,
  signInConfig,
  unavailable,
  upload,
  webSignInRoutes,
  wipeBrowserStorage,
} from "./identity/index.ts";
import { log } from "./log.ts";
import {
  checkSend,
  getMedia,
  MAX_CIPHERTEXT,
  muteRoutes,
  putMedia,
} from "./modules/messaging/index.ts";
import { communityRoutes } from "./modules/communities/index.ts";
import { historyRoutes } from "./modules/history/index.ts";
import { moderationRoutes } from "./modules/moderation/index.ts";
import { notificationRoutes } from "./modules/notifications/index.ts";
import { socialRoutes } from "./modules/social/index.ts";
import { accountRoutes, photoRoutes } from "./modules/profiles/index.ts";
import { opsRoutes } from "./ops/index.ts";

/**
 * OpenAPI 3.1 document metadata; the routes and schemas come from src/api/.
 * `x-frame-specs` is the pixel size of every image frame (decision 0086), for
 * the clients that cut previews and for `tooling/frames-check.mjs`;
 * `x-size-classes` is where each window size class begins (decisions 0086,
 * 0087), the one definition every client's layout keys off.
 */
export const DOCUMENT_INFO = {
  openapi: "3.1.0",
  info: { title: "spjall-api", version: "0.1.0" },
  "x-frame-specs": FRAME_SPECS,
  "x-size-classes": SIZE_CLASSES,
} as const;

/**
 * What every handler sees: the bindings, the session the request acts in,
 * the device a token resolved to on a route that takes one, and the
 * request's id (decision 0037).
 */
export type AppEnv = {
  Bindings: Env;
  Variables: { session: Session; device: Device; requestId: string };
};

export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return fail(c, 400, "invalid_request");
    },
  });
  app.onError(failed);
  app.notFound((c) => fail(c, 404, "not_found"));

  registerSchemes(app);
  const { publicLimit, credentials } = guards(app);
  app.use("*", drainBody);
  app.use("*", requestId);
  app.use("/v1/*", clientFloor);
  app.use("/v1/*", publicLimit);
  app.use("/v1/*", credentials);

  app.openapi(healthRoute, (c) =>
    c.json(
      {
        status: "ok" as const,
        minClientVersion: minClientVersions(c.env),
        updateUrl: updateUrls(c.env),
      },
      200,
    ),
  );

  // Sign-in (decision 0019). Routes are registered in the order
  // api/openapi.json lists them.
  app.openapi(signInConfigRoute, async (c) => {
    const name = c.req.valid("query").provider ?? "kenni";
    const provider = identityProvider(c.env, name);
    if (!provider) return fail(c, 503, unavailable(name));
    try {
      return c.json(await signInConfig(provider), 200);
    } catch {
      log("sign_in.failed", {
        code: "discovery_failed",
        provider: name,
        requestId: c.var.requestId,
      });
      return fail(c, 503, unavailable(name));
    }
  });

  app.openapi(registerDeviceRoute, async (c) => {
    const body = c.req.valid("json");
    const code = body.code ?? body.kenniCode;
    if (!code) return fail(c, 400, "invalid_request");
    const person = await authorized(c.env, { ...body, provider: body.provider ?? "kenni", code });
    if ("error" in person) {
      return person.error === "sign_in_failed"
        ? fail(c, 403, person.error)
        : fail(c, 503, person.error);
    }
    const registered = await registerDevice(c.env, person.ok, {
      platform: body.platform,
      deviceKey: fromBase64(body.deviceKey),
      inviteToken: body.inviteToken,
    });
    if ("error" in registered) {
      log("sign_in.failed", { code: registered.error, requestId: c.var.requestId });
      return fail(c, 409, registered.error);
    }
    const { accountId, deviceId, sessionId } = registered.ok;
    log("device.registered", { accountId, deviceId, sessionId, provider: person.ok.provider });
    return c.json(registered.ok, 200);
  });

  app.openapi(linkIdentityRoute, async (c) => {
    const body = c.req.valid("json");
    const person = await authorized(c.env, body);
    if ("error" in person) {
      return person.error === "sign_in_failed"
        ? fail(c, 403, person.error)
        : fail(c, 503, person.error);
    }
    const caller = { ...c.var.session, deviceId: c.var.device.deviceId };
    const linked = await linkOrJoin(c.env, caller, person.ok, c.var.requestId, body.merge ?? false);
    if ("error" in linked) return fail(c, 409, linked.error);
    // A client that may be moved hears where it now is (decision 0035).
    return body.merge ? c.json({ accountId: linked.ok.accountId }, 200) : c.body(null, 204);
  });

  app.openapi(getMeRoute, async (c) => {
    const { accountId } = c.var.session;
    const deviceId = c.var.device?.deviceId;
    const account = await me(c.env, accountId);
    const devices = account.devices.map((d) => ({ ...d, current: d.deviceId === deviceId }));
    const { name, verified, photo } = account;
    return c.json({ accountId, name, verified, photo, devices }, 200);
  });

  inviteRoutes(app);
  sessionRoutes(app);
  linkedDeviceRoutes(app);
  historyRoutes(app);

  // Decision 0014: in the contract now, built in phase 1.
  app.openapi(revokeDeviceRoute, async (c) => {
    const { accountId, kind } = c.var.session;
    const { deviceId } = c.req.valid("param");
    if (!(await revokeDevice(c.env, accountId, deviceId))) {
      return fail(c, 404, "not_found");
    }
    await inbox(c.env, accountId).closeDevice(deviceId);
    if (kind === "web") wipeBrowserStorage(c);
    log("device.revoked", { accountId, deviceId });
    return c.body(null, 204);
  });

  // Push tokens (decision 0025): a device sets and removes only its own.
  app.openapi(setPushTokenRoute, async (c) => {
    const { deviceId } = c.var.device;
    if (c.req.valid("param").deviceId !== deviceId) {
      return fail(c, 403, "not_this_device");
    }
    const { token, sandbox } = c.req.valid("json");
    await setPushToken(c.env, deviceId, token, sandbox ?? false);
    log("device.push_token_set", { deviceId });
    return c.body(null, 204);
  });

  app.openapi(clearPushTokenRoute, async (c) => {
    const { deviceId } = c.var.device;
    if (c.req.valid("param").deviceId !== deviceId) {
      return fail(c, 403, "not_this_device");
    }
    await clearPushToken(c.env, deviceId);
    log("device.push_token_cleared", { deviceId });
    return c.body(null, 204);
  });

  app.openapi(deleteAccountRoute, async (c) => {
    const { accountId } = c.var.session;
    await deleteAccount(c.env, accountId);
    log("account.deleted", { accountId });
    return c.body(null, 204);
  });

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

  // Muting (decision 0042).
  muteRoutes(app);

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

  // KeyPackages in D1 (decision 0017).
  app.openapi(uploadKeyPackagesRoute, async (c) => {
    const stock = await upload(c.env, c.var.device, c.req.valid("json"));
    return stock ? c.json(stock, 200) : fail(c, 400, "invalid_request");
  });

  app.openapi(claimKeyPackagesRoute, async (c) => {
    if (!(await withinLimit(c.env, "claims", c.var.device.accountId))) {
      log("request.rate_limited", { code: "claims", requestId: c.var.requestId });
      return fail(c, 429, "rate_limited");
    }
    const { accountId } = c.req.valid("param");
    if (await blockedByAny(c.env, c.var.device.accountId, [accountId])) {
      return fail(c, 403, "blocked");
    }
    const claimed = await claim(c.env, accountId, c.var.device.deviceId);
    if (claimed === "none") return fail(c, 404, "not_found");
    if (claimed === "expired") return fail(c, 409, "no_key_packages");
    const keyPackages = claimed.map((p) => ({
      deviceId: p.deviceId,
      keyPackage: toBase64(p.keyPackage),
    }));
    return c.json({ keyPackages }, 200);
  });

  // Other accounts, the directory and block (decisions 0022, 0024, 0036).
  accountRoutes(app);

  // The profile photo (decision 0039).
  photoRoutes(app);

  // Communities and membership (decision 0063).
  communityRoutes(app, communityLifecycle);
  socialRoutes(app);
  moderationRoutes(app);
  notificationRoutes(app);

  // The maintainer's jobs and restore, behind OPS_TOKEN (decision 0068).
  opsRoutes(app);

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

  // The frames are not a route body, so they are registered as a component
  // for the generators (decision 0005); /v1/ws points at it.
  app.openAPIRegistry.register("WsFrame", WsFrame);

  // The link host shares the Worker but not the contract.
  app.route("/", linkHost());
  app.route("/", webSignInRoutes(linkOrJoin));

  return app;
}
