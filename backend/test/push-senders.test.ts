import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { brandStrings } from "../src/brand.gen.ts";
import { fromBase64, toBase64 } from "../src/bytes.ts";
import { pushConfig } from "../src/env/index.ts";
import { apnsPayload } from "../src/push/apns.ts";
import { fcmMessage } from "../src/push/fcm.ts";
import { pushSender, sender } from "../src/push/index.ts";
import { device } from "./support.ts";

// The FCM and APNs senders (decision 0025): JWTs signed with WebCrypto, a
// payload that names nothing, a dead token cleared, a provider outage left
// for the Inbox alarm to retry.

const decoder = new TextDecoder();
const fromBase64url = (text: string) =>
  fromBase64(
    text
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(text.length / 4) * 4, "="),
  );
const jsonPart = (text: string) => JSON.parse(decoder.decode(fromBase64url(text)));

async function keyPair(alg: "RS256" | "ES256") {
  const params =
    alg === "RS256"
      ? {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: Uint8Array.of(1, 0, 1),
          hash: "SHA-256",
        }
      : { name: "ECDSA", namedCurve: "P-256" };
  const pair = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  const body = toBase64(der).replace(/.{64}/g, "$&\n");
  const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
  const verify = async (jwt: string) => {
    const [header, claims, signature] = jwt.split(".") as [string, string, string];
    const algorithm =
      alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-256" };
    return crypto.subtle.verify(
      algorithm,
      pair.publicKey,
      fromBase64url(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    );
  };
  return { pem, verify };
}

type Seen = { url: string; headers: Headers; body: string };

/** A provider that answers each request with the next of `answers`. */
function provider(...answers: Response[]) {
  const seen: Seen[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push({ url: request.url, headers: request.headers, body: await request.text() });
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected request to ${request.url}`);
    return answer;
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const oauth = () => json({ access_token: "ya29.test", expires_in: 3600 });

let accounts = 0;
async function fcm() {
  const { pem, verify } = await keyPair("RS256");
  return {
    verify,
    account: {
      projectId: "spjall-test",
      clientEmail: `push-${++accounts}@spjall-test.iam.gserviceaccount.com`,
      privateKey: pem,
      tokenUri: "https://oauth2.googleapis.com/token",
    },
  };
}

let keyIds = 0;
async function apns() {
  const { pem, verify } = await keyPair("ES256");
  return {
    verify,
    key: {
      keyId: `KEY${++keyIds}`,
      teamId: "TEAM123456",
      privateKey: pem,
      topic: "is.samtak.spjall",
    },
  };
}

async function withToken(platform: "android" | "ios", token: string, sandbox = 0) {
  const me = await device();
  await env.DB.prepare(
    "UPDATE devices SET platform = ?, push_token = ?, push_sandbox = ? WHERE device_id = ?",
  )
    .bind(platform, token, sandbox, me.deviceId)
    .run();
  return me;
}

const tokenOf = async (deviceId: string) =>
  (
    await env.DB.prepare("SELECT push_token AS token FROM devices WHERE device_id = ?")
      .bind(deviceId)
      .first<{ token: string | null }>()
  )?.token;

let logs: MockInstance<typeof console.log>;
beforeEach(() => {
  logs = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => logs.mockRestore());
const events = () => logs.mock.calls.map(([line]) => JSON.parse(String(line)).event as string);

describe("FCM", () => {
  it("trades a signed JWT for an OAuth token once, and sends a message that names nothing", async () => {
    const { account, verify } = await fcm();
    const me = await withToken("android", "fcm-registration-1");
    const { fetch, seen } = provider(oauth(), json({ name: "m/1" }), json({ name: "m/2" }));
    const push = sender({ fcm: account, fetch }, env.DB);

    await push.send({ deviceId: me.deviceId });
    await push.send({ deviceId: me.deviceId });

    expect(seen.map((s) => s.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://fcm.googleapis.com/v1/projects/spjall-test/messages:send",
      "https://fcm.googleapis.com/v1/projects/spjall-test/messages:send",
    ]);
    const form = new URLSearchParams(seen[0]!.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = form.get("assertion")!;
    expect(await verify(assertion)).toBe(true);
    const [header, claims] = assertion.split(".") as [string, string];
    expect(jsonPart(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(jsonPart(claims)).toMatchObject({
      iss: account.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: account.tokenUri,
    });

    expect(seen[1]!.headers.get("authorization")).toBe("Bearer ya29.test");
    expect(JSON.parse(seen[1]!.body)).toEqual(fcmMessage("fcm-registration-1"));
    expect(fcmMessage("t")).toEqual({
      message: { token: "t", data: { v: "1" }, android: { priority: "HIGH" } },
    });
    expect(events()).toEqual(["push.sent", "push.sent"]);
  });

  it("clears a token FCM calls unregistered, and sends nothing to it again", async () => {
    const { account } = await fcm();
    const me = await withToken("android", "fcm-registration-dead");
    const unregistered = json(
      { error: { code: 404, details: [{ errorCode: "UNREGISTERED" }] } },
      404,
    );
    const { fetch, seen } = provider(oauth(), unregistered);
    const push = sender({ fcm: account, fetch }, env.DB);

    await push.send({ deviceId: me.deviceId });
    expect(await tokenOf(me.deviceId)).toBeNull();
    await push.send({ deviceId: me.deviceId });
    expect(seen).toHaveLength(2);
    expect(events()).toEqual(["push.dead", "push.no_token"]);
  });

  it("throws on an outage, so the Inbox alarm retries, and keeps the token", async () => {
    const { account } = await fcm();
    const me = await withToken("android", "fcm-registration-later");
    const { fetch } = provider(oauth(), json({ error: { code: 503 } }, 503));
    const push = sender({ fcm: account, fetch }, env.DB);

    await expect(push.send({ deviceId: me.deviceId })).rejects.toThrow("fcm 503");
    expect(await tokenOf(me.deviceId)).toBe("fcm-registration-later");
  });
});

describe("APNs", () => {
  it("signs an ES256 provider token and sends the fallback alert with no custom keys", async () => {
    const { key, verify } = await apns();
    const me = await withToken("ios", "a1b2c3", 1);
    const { fetch, seen } = provider(new Response(null, { status: 200 }));
    await sender({ apns: key, fetch }, env.DB).send({ deviceId: me.deviceId });

    const [request] = seen;
    expect(request!.url).toBe("https://api.sandbox.push.apple.com/3/device/a1b2c3");
    expect(request!.headers.get("apns-topic")).toBe("is.samtak.spjall");
    expect(request!.headers.get("apns-push-type")).toBe("alert");
    expect(request!.headers.get("apns-priority")).toBe("10");
    const jwt = request!.headers.get("authorization")!.replace(/^bearer /, "");
    expect(await verify(jwt)).toBe(true);
    const [header, claims] = jwt.split(".") as [string, string];
    expect(jsonPart(header)).toEqual({ alg: "ES256", typ: "JWT", kid: key.keyId });
    expect(jsonPart(claims)).toMatchObject({ iss: "TEAM123456" });

    expect(JSON.parse(request!.body)).toEqual(apnsPayload());
    expect(Object.keys(apnsPayload())).toEqual(["aps"]);
    expect(apnsPayload().aps.alert).toEqual({ body: brandStrings.push_fallback_body });
    expect(events()).toEqual(["push.sent"]);
  });

  it("sends a production token to production, and clears one Apple calls gone", async () => {
    const { key } = await apns();
    const me = await withToken("ios", "d4e5f6");
    const { fetch, seen } = provider(json({ reason: "Unregistered" }, 410));
    await sender({ apns: key, fetch }, env.DB).send({ deviceId: me.deviceId });
    expect(seen[0]!.url).toBe("https://api.push.apple.com/3/device/d4e5f6");
    expect(await tokenOf(me.deviceId)).toBeNull();
  });

  it("clears a bad device token, and retries an expired provider token", async () => {
    const { key } = await apns();
    const bad = await withToken("ios", "badbad");
    const later = await withToken("ios", "fine01");
    const { fetch } = provider(
      json({ reason: "BadDeviceToken" }, 400),
      json({ reason: "ExpiredProviderToken" }, 403),
    );
    const push = sender({ apns: key, fetch }, env.DB);
    await push.send({ deviceId: bad.deviceId });
    expect(await tokenOf(bad.deviceId)).toBeNull();
    await expect(push.send({ deviceId: later.deviceId })).rejects.toThrow("ExpiredProviderToken");
    expect(await tokenOf(later.deviceId)).toBe("fine01");
  });
});

describe("the sender", () => {
  it("is the skipped one with no credentials, as in tests and local development", async () => {
    expect(pushConfig(env)).toEqual({ fetch: expect.any(Function) });
    await pushSender(env).send({ deviceId: "dev_none" });
    expect(events()).toEqual(["push.skipped"]);
  });

  it("leaves out a malformed service account rather than failing", () => {
    const config = pushConfig({ ...env, FCM_SERVICE_ACCOUNT: "{not json" } as Env);
    expect(config.fcm).toBeUndefined();
    expect(events()).toEqual(["push.misconfigured"]);
  });

  it("skips a platform it has no credentials for", async () => {
    const { key } = await apns();
    const android = await withToken("android", "fcm-without-account");
    const { fetch, seen } = provider();
    await sender({ apns: key, fetch }, env.DB).send({ deviceId: android.deviceId });
    expect(seen).toEqual([]);
    expect(events()).toEqual(["push.skipped"]);
  });
});
