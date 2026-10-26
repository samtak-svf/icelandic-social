import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  clearPushTokenRoute,
  deleteAccountRoute,
  getMeRoute,
  linkIdentityRoute,
  registerDeviceRoute,
  revokeDeviceRoute,
  setPushTokenRoute,
  signInConfigRoute,
} from "../api/devices.ts";
import { claimKeyPackagesRoute, uploadKeyPackagesRoute } from "../api/key-packages.ts";
import { fromBase64, toBase64 } from "../bytes.ts";
import { identityProvider, inbox, withinLimit } from "../env/index.ts";
import { fail } from "../errors.ts";
import type { AppEnv } from "../http.ts";
import { log } from "../log.ts";
import { clearPushToken, me, registerDevice, revokeDevice, setPushToken } from "./accounts.ts";
import { blockedByAny } from "./blocks.ts";
import { claim, upload } from "./key-packages.ts";
import type { Caller, linkIdentity } from "./linking.ts";
import { authorized, type Person, signInConfig, unavailable } from "./providers.ts";
import { wipeBrowserStorage } from "./sessions.ts";

/**
 * What identity's routes need from code that sits above the modules, handed
 * in by the app like the other modules' hooks: deleting an account reaches
 * every module that holds its data, and a link that merges deletes the account
 * it joins (decisions 0035, 0069).
 */
type IdentityHooks = {
  deleteAccount: (env: Env, accountId: string) => Promise<void>;
  linkOrJoin: (
    env: Env,
    caller: Caller,
    person: Person,
    requestId: string,
    merge?: boolean,
  ) => ReturnType<typeof linkIdentity>;
};

/**
 * Sign-in config, devices, identities, the caller's account, push tokens,
 * deleting the account, and KeyPackages (decision 0017), which identity owns
 * because a device's KeyPackages live and die with it.
 */
export function identityRoutes(app: OpenAPIHono<AppEnv>, hooks: IdentityHooks): void {
  // Sign-in (decision 0019).
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
    const linked = await hooks.linkOrJoin(
      c.env,
      caller,
      person.ok,
      c.var.requestId,
      body.merge ?? false,
    );
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
    await hooks.deleteAccount(c.env, accountId);
    log("account.deleted", { accountId });
    return c.body(null, 204);
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
}
