import { env } from "cloudflare:workers";
import { fromBase64, toBase64 } from "../src/bytes.ts";
import { device } from "./support.ts";

// Push providers for the tests (decision 0025): FCM and APNs credentials with
// real keys, a provider that records what it was sent, and devices with a
// push token.

export const fromBase64url = (text: string) =>
  fromBase64(
    text
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(text.length / 4) * 4, "="),
  );

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
export function provider(...answers: Response[]) {
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

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const oauth = () => json({ access_token: "ya29.test", expires_in: 3600 });

let accounts = 0;
export async function fcm() {
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
export async function apns() {
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

export async function withToken(platform: "android" | "ios", token: string, sandbox = 0) {
  const me = await device();
  await env.DB.prepare(
    "UPDATE devices SET platform = ?, push_token = ?, push_sandbox = ? WHERE device_id = ?",
  )
    .bind(platform, token, sandbox, me.deviceId)
    .run();
  return me;
}
