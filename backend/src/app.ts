import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import {
  type Device,
  deleteAccount,
  deviceForToken,
  clearPushToken,
  linkIdentity,
  me,
  registerDevice,
  revokeDevice,
  setPushToken,
} from "./accounts.ts";
import { blockRoute, getAccountRoute, listBlocksRoute, unblockRoute } from "./api/accounts.ts";
import {
  createConversationRoute,
  getConversationDevicesRoute,
  getGroupInfoRoute,
  getWelcomeRoute,
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
import { healthRoute } from "./api/health.ts";
import { resolveInviteRoute, revokeInviteRoute, rotateInviteRoute } from "./api/invites.ts";
import { claimKeyPackagesRoute, uploadKeyPackagesRoute } from "./api/key-packages.ts";
import { getMediaRoute, putMediaRoute } from "./api/media.ts";
import { listMessagesRoute, sendMessageRoute } from "./api/messages.ts";
import { SOCKET_ACCOUNT, SOCKET_DEVICE, socketRoute } from "./api/socket.ts";
import { block, blockedByAny, blockList, unblock } from "./blocks.ts";
import { fromBase64, toBase64 } from "./bytes.ts";
import { belowFloor, CLIENT_HEADER } from "./client-version.ts";
import { checkSend } from "./conversations.ts";
import {
  conversation,
  identityProvider,
  inbox,
  minClientVersions,
  withinLimit,
} from "./env/index.ts";
import { authorized, signInConfig, unavailable } from "./identity.ts";
import { inviteLink, resolveInvite, revokeInvite, rotateInvite } from "./invites.ts";
import { claim, ownsLeaf, upload } from "./key-packages.ts";
import { postRoutes } from "./feed.ts";
import { linkHost } from "./link.ts";
import { log } from "./log.ts";
import { getMedia, MAX_CIPHERTEXT, putMedia } from "./media.ts";
import { activeDevices, profile } from "./profiles.ts";

/** OpenAPI 3.1 document metadata; the routes and schemas come from src/api/. */
export const DOCUMENT_INFO = {
  openapi: "3.1.0",
  info: { title: "spjall-api", version: "0.1.0" },
} as const;

const BEARER = /^Bearer ([A-Za-z0-9_-]{16,256})$/;

/** What every handler sees: the bindings, and the device a token resolved to. */
export type AppEnv = { Bindings: Env; Variables: { device: Device } };

/** The /v1 routes a person reaches before they have a device (decision 0019). */
const PUBLIC = [/^GET \/v1\/sign-in$/, /^POST \/v1\/devices$/, /^GET \/v1\/invites\/[^/]+$/];

const isPublic = (c: { req: { method: string; path: string } }) =>
  PUBLIC.some((pattern) => pattern.test(`${c.req.method} ${c.req.path}`));

/** Every /v1 route refuses a build below its platform's floor (decision 0030). */
const clientFloor = createMiddleware<AppEnv>(async (c, next) => {
  const refusal = belowFloor(c.env, c.req.header(CLIENT_HEADER));
  if (!refusal) return next();
  return refusal.error === "invalid_request" ? c.json(refusal, 400) : c.json(refusal, 426);
});

/**
 * The public routes are limited per address. Cloudflare sets
 * cf-connecting-ip on every request it serves; only workerd on its own, in
 * tests and `cf dev`, leaves it out, and those are not limited.
 */
const publicLimit = createMiddleware<AppEnv>(async (c, next) => {
  const address = c.req.header("cf-connecting-ip");
  if (!isPublic(c) || !address) return next();
  if (await withinLimit(c.env, "public", address)) return next();
  log("request.rate_limited", { code: "public" });
  return c.json({ error: "rate_limited" }, 429);
});

/**
 * Every other /v1 route needs a device token (decision 0014): its hash must
 * name an active device in D1, which the handlers then act as.
 */
const deviceToken = createMiddleware<AppEnv>(async (c, next) => {
  if (isPublic(c)) return next();
  const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
  const device = token ? await deviceForToken(c.env, token) : null;
  if (!device) return c.json({ error: "unauthorized" }, 401);
  c.set("device", device);
  return next();
});

export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: "invalid_request" }, 400);
    },
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "deviceToken", {
    type: "http",
    scheme: "bearer",
    description: "The device token from registerDevice (decision 0014)",
  });
  app.use("/v1/*", clientFloor);
  app.use("/v1/*", publicLimit);
  app.use("/v1/*", deviceToken);

  app.openapi(healthRoute, (c) =>
    c.json({ status: "ok" as const, minClientVersion: minClientVersions(c.env) }, 200),
  );

  // Sign-in (decision 0019). Routes are registered in the order
  // api/openapi.json lists them.
  app.openapi(signInConfigRoute, async (c) => {
    const name = c.req.valid("query").provider ?? "kenni";
    const provider = identityProvider(c.env, name);
    if (!provider) return c.json({ error: unavailable(name) }, 503);
    try {
      return c.json(await signInConfig(provider), 200);
    } catch {
      log("sign_in.failed", { code: "discovery_failed", provider: name });
      return c.json({ error: unavailable(name) }, 503);
    }
  });

  app.openapi(registerDeviceRoute, async (c) => {
    const body = c.req.valid("json");
    const code = body.code ?? body.kenniCode;
    if (!code) return c.json({ error: "invalid_request" }, 400);
    const person = await authorized(c.env, { ...body, provider: body.provider ?? "kenni", code });
    if ("error" in person) {
      return person.error === "sign_in_failed"
        ? c.json({ error: person.error }, 403)
        : c.json({ error: person.error }, 503);
    }
    const registered = await registerDevice(c.env, person.ok, {
      platform: body.platform,
      deviceKey: fromBase64(body.deviceKey),
      inviteToken: body.inviteToken,
    });
    if ("error" in registered) {
      log("sign_in.failed", { code: registered.error });
      return c.json({ error: registered.error }, 409);
    }
    const { accountId, deviceId } = registered.ok;
    log("device.registered", { accountId, deviceId, provider: person.ok.provider });
    return c.json(registered.ok, 200);
  });

  app.openapi(linkIdentityRoute, async (c) => {
    const { accountId } = c.var.device;
    const body = c.req.valid("json");
    const person = await authorized(c.env, body);
    if ("error" in person) {
      return person.error === "sign_in_failed"
        ? c.json({ error: person.error }, 403)
        : c.json({ error: person.error }, 503);
    }
    const linked = await linkIdentity(c.env, c.var.device, person.ok, { merge: body.merge });
    if ("error" in linked) {
      log("identity.link_refused", { accountId, code: linked.error, provider: body.provider });
      return c.json({ error: linked.error }, 409);
    }
    const into = { accountId: linked.ok.accountId, deviceId: c.var.device.deviceId };
    if (linked.ok.merged) log("account.merged_away", { accountId });
    log(linked.ok.merged ? "identity.merged" : "identity.linked", {
      ...into,
      provider: body.provider,
    });
    // A client that may be moved hears where it now is (decision 0035).
    return body.merge ? c.json({ accountId: linked.ok.accountId }, 200) : c.body(null, 204);
  });

  app.openapi(getMeRoute, async (c) => {
    const { accountId, deviceId } = c.var.device;
    const account = await me(c.env, accountId);
    const devices = account.devices.map((d) => ({ ...d, current: d.deviceId === deviceId }));
    return c.json({ accountId, name: account.name, verified: account.verified, devices }, 200);
  });

  // Invites (decision 0019).
  app.openapi(rotateInviteRoute, async (c) => {
    const token = await rotateInvite(c.env, c.var.device.accountId);
    log("invite.rotated", { accountId: c.var.device.accountId });
    return c.json({ token, link: inviteLink(token) }, 200);
  });

  app.openapi(revokeInviteRoute, async (c) => {
    await revokeInvite(c.env, c.var.device.accountId);
    log("invite.revoked", { accountId: c.var.device.accountId });
    return c.body(null, 204);
  });

  app.openapi(resolveInviteRoute, async (c) => {
    const invite = await resolveInvite(c.env, c.req.valid("param").token);
    return invite ? c.json(invite, 200) : c.json({ error: "not_found" }, 404);
  });

  // Decision 0014: in the contract now, built in phase 1.
  app.openapi(revokeDeviceRoute, async (c) => {
    const { accountId } = c.var.device;
    const { deviceId } = c.req.valid("param");
    if (!(await revokeDevice(c.env, accountId, deviceId))) {
      return c.json({ error: "not_found" }, 404);
    }
    await inbox(c.env, accountId).closeDevice(deviceId);
    log("device.revoked", { accountId, deviceId });
    return c.body(null, 204);
  });

  // Push tokens (decision 0025): a device sets and removes only its own.
  app.openapi(setPushTokenRoute, async (c) => {
    const { deviceId } = c.var.device;
    if (c.req.valid("param").deviceId !== deviceId) {
      return c.json({ error: "not_this_device" }, 403);
    }
    const { token, sandbox } = c.req.valid("json");
    await setPushToken(c.env, deviceId, token, sandbox ?? false);
    log("device.push_token_set", { deviceId });
    return c.body(null, 204);
  });

  app.openapi(clearPushTokenRoute, async (c) => {
    const { deviceId } = c.var.device;
    if (c.req.valid("param").deviceId !== deviceId) {
      return c.json({ error: "not_this_device" }, 403);
    }
    await clearPushToken(c.env, deviceId);
    log("device.push_token_cleared", { deviceId });
    return c.body(null, 204);
  });

  app.openapi(deleteAccountRoute, async (c) => {
    const { accountId } = c.var.device;
    await deleteAccount(c.env, accountId);
    log("account.deleted", { accountId });
    return c.body(null, 204);
  });

  // Conversations (decisions 0015, 0017). The Worker reads the framing; the
  // Conversation DO decides membership, order and the epoch.
  app.openapi(sendMessageRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const checked = checkSend(c.var.device.accountId, conversationId, c.req.valid("json"));
    if ("error" in checked) return c.json({ error: checked.error }, 400);
    // An external commit's leaf is the device joining: this one (0021).
    if (checked.joiner && !(await ownsLeaf(c.env, c.var.device, checked.joiner))) {
      return c.json({ error: "invalid_request" }, 400);
    }
    // A commit cannot bring in an account that has blocked its sender (0024).
    const added = checked.ok.welcome?.to ?? [];
    if (await blockedByAny(c.env, c.var.device.accountId, added)) {
      return c.json({ error: "blocked" }, 403);
    }
    const result = await conversation(c.env, conversationId).send(checked.ok);
    if ("ok" in result) return c.json(result.ok, 200);
    switch (result.error) {
      case "not_found":
        return c.json({ error: result.error }, 404);
      case "not_a_member":
        return c.json({ error: result.error }, 403);
      case "epoch_conflict":
      case "claim_names_departed":
        return c.json({ error: result.error }, 409);
      default:
        return c.json({ error: "invalid_request" }, 400);
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
        ? c.json({ error: result.error }, 404)
        : c.json({ error: "not_a_member" }, 403);
    }
    const messages = result.ok.messages.map((m) => ({
      seq: m.seq,
      ciphertext: toBase64(m.ciphertext),
    }));
    return c.json({ messages, more: result.ok.more }, 200);
  });

  app.openapi(createConversationRoute, async (c) => {
    const { conversationId } = c.req.valid("json");
    const result = await conversation(c.env, conversationId).create(
      c.var.device.accountId,
      conversationId,
    );
    return "ok" in result
      ? c.json({ conversationId }, 200)
      : c.json({ error: "conversation_exists" }, 409);
  });

  app.openapi(getWelcomeRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const result = await conversation(c.env, conversationId).welcome(c.var.device.accountId);
    if ("error" in result) {
      return result.error === "not_a_member"
        ? c.json({ error: result.error }, 403)
        : c.json({ error: "not_found" }, 404);
    }
    return c.json({ seq: result.ok.seq, welcome: toBase64(result.ok.welcome) }, 200);
  });

  app.openapi(getGroupInfoRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const result = await conversation(c.env, conversationId).groupInfo(c.var.device.accountId);
    if ("error" in result) {
      return result.error === "not_a_member"
        ? c.json({ error: result.error }, 403)
        : c.json({ error: "not_found" }, 404);
    }
    return c.json({ seq: result.ok.seq, groupInfo: toBase64(result.ok.groupInfo) }, 200);
  });

  app.openapi(getConversationDevicesRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const result = await conversation(c.env, conversationId).roster(c.var.device.accountId);
    if ("error" in result) {
      return result.error === "not_a_member"
        ? c.json({ error: result.error }, 403)
        : c.json({ error: "not_found" }, 404);
    }
    return c.json({ accounts: await activeDevices(c.env, result.ok) }, 200);
  });

  // Media (decision 0023): the roster check is the Conversation DO's, as for messages.
  app.openapi(putMediaRoute, async (c) => {
    const { conversationId, mediaId } = c.req.valid("param");
    const body = c.req.raw.body;
    // A refusal cancels the body, so the client stops sending it.
    const refuse = async <T>(answer: T) => (await body?.cancel(), answer);
    const length = Number(c.req.header("content-length") ?? Number.NaN);
    if (!Number.isSafeInteger(length) || length < 1 || !body) {
      return refuse(c.json({ error: "invalid_request" }, 400));
    }
    if (length > MAX_CIPHERTEXT) return refuse(c.json({ error: "too_large" }, 413));
    const { accountId } = c.var.device;
    const member = await conversation(c.env, conversationId).member(accountId);
    if ("error" in member) {
      return member.error === "not_found"
        ? refuse(c.json({ error: member.error }, 404))
        : refuse(c.json({ error: "not_a_member" }, 403));
    }
    try {
      const stored = await putMedia(c.env, {
        mediaId,
        conversationId,
        accountId,
        size: length,
        body,
      });
      if (stored === "conflict") return refuse(c.json({ error: "conflict" }, 409));
    } catch {
      // The body ended short of, or ran past, its Content-Length.
      return c.json({ error: "invalid_request" }, 400);
    }
    return c.body(null, 204);
  });

  app.openapi(getMediaRoute, async (c) => {
    const { conversationId, mediaId } = c.req.valid("param");
    const member = await conversation(c.env, conversationId).member(c.var.device.accountId);
    if ("error" in member) {
      return member.error === "not_found"
        ? c.json({ error: member.error }, 404)
        : c.json({ error: "not_a_member" }, 403);
    }
    const object = await getMedia(c.env, conversationId, mediaId);
    if (!object) return c.json({ error: "not_found" }, 404);
    return c.body(object.body, 200, {
      "content-type": "application/octet-stream",
      "content-length": String(object.size),
    });
  });

  // KeyPackages in D1 (decision 0017).
  app.openapi(uploadKeyPackagesRoute, async (c) => {
    const stock = await upload(c.env, c.var.device, c.req.valid("json"));
    return stock ? c.json(stock, 200) : c.json({ error: "invalid_request" }, 400);
  });

  app.openapi(claimKeyPackagesRoute, async (c) => {
    if (!(await withinLimit(c.env, "claims", c.var.device.accountId))) {
      log("request.rate_limited", { code: "claims" });
      return c.json({ error: "rate_limited" }, 429);
    }
    const { accountId } = c.req.valid("param");
    if (await blockedByAny(c.env, c.var.device.accountId, [accountId])) {
      return c.json({ error: "blocked" }, 403);
    }
    const claimed = await claim(c.env, accountId, c.var.device.deviceId);
    if (claimed === "none") return c.json({ error: "not_found" }, 404);
    if (claimed === "expired") return c.json({ error: "no_key_packages" }, 409);
    const keyPackages = claimed.map((p) => ({
      deviceId: p.deviceId,
      keyPackage: toBase64(p.keyPackage),
    }));
    return c.json({ keyPackages }, 200);
  });

  // Other accounts (decisions 0022, 0024).
  app.openapi(getAccountRoute, async (c) => {
    const found = await profile(c.env, c.req.valid("param").accountId);
    return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
  });

  app.openapi(listBlocksRoute, async (c) =>
    c.json({ blocked: await blockList(c.env, c.var.device.accountId) }, 200),
  );

  app.openapi(blockRoute, async (c) => {
    const { accountId } = c.var.device;
    const target = c.req.valid("param").accountId;
    if (target === accountId) return c.json({ error: "invalid_request" }, 400);
    if (!(await block(c.env, accountId, target))) return c.json({ error: "not_found" }, 404);
    log("account.blocked", { accountId });
    return c.body(null, 204);
  });

  app.openapi(unblockRoute, async (c) => {
    const { accountId } = c.var.device;
    await unblock(c.env, accountId, c.req.valid("param").accountId);
    log("account.unblocked", { accountId });
    return c.body(null, 204);
  });

  // Fljótið and the walls (decision 0034).
  postRoutes(app);

  // The socket lives in the account's Inbox; the Worker tells it which
  // device this is, replacing any such header the client sent.
  app.openapi(socketRoute, async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "upgrade_required" }, 426);
    }
    const { accountId, deviceId } = c.var.device;
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

  return app;
}
