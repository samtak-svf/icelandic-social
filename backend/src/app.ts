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
import { blockedByAny } from "./blocks.ts";
import { fromBase64, toBase64 } from "./bytes.ts";
import { belowFloor, CLIENT_HEADER } from "./client-version.ts";
import { checkSend } from "./conversations.ts";
import { fail, failed, requestId } from "./errors.ts";
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
import { accountRoutes } from "./people.ts";
import { linkHost } from "./link.ts";
import { log } from "./log.ts";
import { getMedia, MAX_CIPHERTEXT, putMedia } from "./media.ts";
import { muteRoutes } from "./mutes.ts";
import { photoRoutes } from "./photos.ts";
import { activeDevices } from "./profiles.ts";

/** OpenAPI 3.1 document metadata; the routes and schemas come from src/api/. */
export const DOCUMENT_INFO = {
  openapi: "3.1.0",
  info: { title: "spjall-api", version: "0.1.0" },
} as const;

const BEARER = /^Bearer ([A-Za-z0-9_-]{16,256})$/;

/**
 * What every handler sees: the bindings, the device a token resolved to, and
 * the request's id (decision 0037).
 */
export type AppEnv = { Bindings: Env; Variables: { device: Device; requestId: string } };

/** The /v1 routes a person reaches before they have a device (decision 0019). */
const PUBLIC = [/^GET \/v1\/sign-in$/, /^POST \/v1\/devices$/, /^GET \/v1\/invites\/[^/]+$/];

const isPublic = (c: { req: { method: string; path: string } }) =>
  PUBLIC.some((pattern) => pattern.test(`${c.req.method} ${c.req.path}`));

/** Every /v1 route refuses a build below its platform's floor (decision 0030). */
const clientFloor = createMiddleware<AppEnv>(async (c, next) => {
  const refusal = belowFloor(c.env, c.req.header(CLIENT_HEADER));
  if (!refusal) return next();
  return refusal.error === "invalid_request"
    ? fail(c, 400, refusal.error)
    : fail(c, 426, refusal.error, { minVersion: refusal.minVersion });
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
  log("request.rate_limited", { code: "public", requestId: c.var.requestId });
  return fail(c, 429, "rate_limited");
});

/**
 * Every other /v1 route needs a device token (decision 0014): its hash must
 * name an active device in D1, which the handlers then act as.
 */
const deviceToken = createMiddleware<AppEnv>(async (c, next) => {
  if (isPublic(c)) return next();
  const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
  const device = token ? await deviceForToken(c.env, token) : null;
  if (!device) return fail(c, 401, "unauthorized");
  c.set("device", device);
  return next();
});

export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return fail(c, 400, "invalid_request");
    },
  });
  app.onError(failed);
  app.notFound((c) => fail(c, 404, "not_found"));

  app.openAPIRegistry.registerComponent("securitySchemes", "deviceToken", {
    type: "http",
    scheme: "bearer",
    description: "The device token from registerDevice (decision 0014)",
  });
  app.use("*", requestId);
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
        ? fail(c, 403, person.error)
        : fail(c, 503, person.error);
    }
    const linked = await linkIdentity(c.env, c.var.device, person.ok, { merge: body.merge });
    if ("error" in linked) {
      log("identity.link_refused", {
        accountId,
        code: linked.error,
        provider: body.provider,
        requestId: c.var.requestId,
      });
      return fail(c, 409, linked.error);
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
    const { name, verified, photo } = account;
    return c.json({ accountId, name, verified, photo, devices }, 200);
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
    return invite ? c.json(invite, 200) : fail(c, 404, "not_found");
  });

  // Decision 0014: in the contract now, built in phase 1.
  app.openapi(revokeDeviceRoute, async (c) => {
    const { accountId } = c.var.device;
    const { deviceId } = c.req.valid("param");
    if (!(await revokeDevice(c.env, accountId, deviceId))) {
      return fail(c, 404, "not_found");
    }
    await inbox(c.env, accountId).closeDevice(deviceId);
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
    if ("error" in checked) return fail(c, 400, checked.error);
    // An external commit's leaf is the device joining: this one (0021).
    if (checked.joiner && !(await ownsLeaf(c.env, c.var.device, checked.joiner))) {
      return fail(c, 400, "invalid_request");
    }
    // A commit cannot bring in an account that has blocked its sender (0024).
    const added = checked.ok.welcome?.to ?? [];
    if (await blockedByAny(c.env, c.var.device.accountId, added)) {
      return fail(c, 403, "blocked");
    }
    const result = await conversation(c.env, conversationId).send(checked.ok);
    if ("ok" in result) return c.json(result.ok, 200);
    switch (result.error) {
      case "not_found":
        return fail(c, 404, result.error);
      case "not_a_member":
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
    return c.json({ accounts: await activeDevices(c.env, result.ok) }, 200);
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

  // The socket lives in the account's Inbox; the Worker tells it which
  // device this is, replacing any such header the client sent.
  app.openapi(socketRoute, async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return fail(c, 426, "upgrade_required");
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
