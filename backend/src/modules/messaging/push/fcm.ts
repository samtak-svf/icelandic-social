import { signJwt } from "./jwt.ts";
import type { Outcome } from "./index.ts";

// Firebase Cloud Messaging, HTTP v1 (decision 0025). A service-account JWT
// is traded for an OAuth token, kept until shortly before it expires. The
// message is data-only, high priority, and names nothing but a version.

export type FcmAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
};

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** An OAuth token is not used in its last five minutes. */
const MARGIN_S = 5 * 60;

const tokens = new Map<string, { token: string; until: number }>();

async function accessToken(account: FcmAccount, fetch: typeof globalThis.fetch) {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokens.get(account.clientEmail);
  if (cached && cached.until > now) return cached.token;
  const assertion = await signJwt(
    "RS256",
    account.privateKey,
    {},
    { iss: account.clientEmail, scope: SCOPE, aud: account.tokenUri, iat: now, exp: now + 3600 },
  );
  const response = await fetch(account.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`fcm oauth ${response.status}`);
  const { access_token, expires_in } = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  tokens.set(account.clientEmail, { token: access_token, until: now + expires_in - MARGIN_S });
  return access_token;
}

/** The payload: no conversation, message or sender, only that there is something. */
export const fcmMessage = (token: string) => ({
  message: { token, data: { v: "1" }, android: { priority: "HIGH" } },
});

type FcmError = { error?: { details?: { errorCode?: string }[] } };

export async function sendFcm(
  account: FcmAccount,
  token: string,
  fetch: typeof globalThis.fetch,
): Promise<Outcome> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await accessToken(account, fetch)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(fcmMessage(token)),
    },
  );
  const { status } = response;
  if (response.ok) return { result: "sent", status };
  const body = (await response.json().catch(() => ({}))) as FcmError;
  const unregistered = body.error?.details?.some((d) => d.errorCode === "UNREGISTERED");
  if (status === 404 || unregistered) return { result: "dead", status };
  if (status === 401) tokens.delete(account.clientEmail);
  if (status === 401 || status === 429 || status >= 500) throw new Error(`fcm ${status}`);
  return { result: "rejected", status };
}
