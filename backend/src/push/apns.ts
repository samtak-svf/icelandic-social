import { brandStrings } from "../brand.gen.ts";
import { signJwt } from "./jwt.ts";
import type { Outcome } from "./index.ts";

// Apple Push Notification service (decision 0025). A provider JWT (ES256) is
// kept for 50 minutes; Apple refuses one older than an hour. The push is an
// alert with the fallback text, which the notification service extension
// rewrites after it syncs; it carries no custom keys.

export type ApnsKey = { keyId: string; teamId: string; privateKey: string; topic: string };

const FRESH_S = 50 * 60;
const tokens = new Map<string, { token: string; at: number }>();

async function providerToken(key: ApnsKey) {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokens.get(key.keyId);
  if (cached && now - cached.at < FRESH_S) return cached.token;
  const token = await signJwt(
    "ES256",
    key.privateKey,
    { kid: key.keyId },
    {
      iss: key.teamId,
      iat: now,
    },
  );
  tokens.set(key.keyId, { token, at: now });
  return token;
}

export const apnsPayload = () => ({
  aps: { alert: { body: brandStrings.push_fallback_body }, sound: "default", "mutable-content": 1 },
});

export async function sendApns(
  key: ApnsKey,
  token: string,
  sandbox: boolean,
  fetch: typeof globalThis.fetch,
): Promise<Outcome> {
  const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const response = await fetch(`https://${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await providerToken(key)}`,
      "apns-topic": key.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(apnsPayload()),
  });
  const { status } = response;
  if (response.ok) return { result: "sent", status };
  const { reason } = (await response.json().catch(() => ({}))) as { reason?: string };
  if (status === 410 || reason === "BadDeviceToken") return { result: "dead", status };
  if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") {
    tokens.delete(key.keyId);
    throw new Error(`apns ${reason}`);
  }
  if (status === 429 || status >= 500) throw new Error(`apns ${status}`);
  return { result: "rejected", status };
}
