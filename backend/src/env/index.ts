// The seam: the only module that reads bindings, vars and secrets, and the
// only place a Durable Object stub is made (tooling/seam-guard.mjs).
//
// Every stub is pinned to the EU jurisdiction per object id. A DO namespace
// has no jurisdiction of its own, so a bare `idFromName` would create the
// object wherever Cloudflare chose and could never be moved (decision 0001).

import ids from "../../../identifiers/ids.json" with { type: "json" };

/** The platforms a client build can report; each has its own minimum version. */
export type Platform = "android" | "ios";

export function minClientVersions(env: Env): Record<Platform, string> {
  return {
    android: env.MIN_CLIENT_VERSION_ANDROID,
    ios: env.MIN_CLIENT_VERSION_IOS,
  };
}

/** D1: accounts, devices, tokens and KeyPackages (decisions 0014, 0017). */
export function db(env: Env): D1Database {
  return env.DB;
}

/**
 * Whether a request may go on: per address on the routes a person reaches
 * before signing in, per account on key-package claims (wrangler.jsonc).
 */
export async function withinLimit(
  env: Env,
  limit: "public" | "claims",
  key: string,
): Promise<boolean> {
  const binding = limit === "public" ? env.PUBLIC_LIMIT : env.CLAIM_LIMIT;
  return (await binding.limit({ key })).success;
}

/** R2: the ciphertext of photos and files (decision 0023), in the EU bucket. */
export function mediaBucket(env: Env): R2Bucket {
  return env.MEDIA;
}

/** The `Conversation` DO for one conversation id: its MLS delivery service. */
export function conversation(env: Env, conversationId: string) {
  return env.CONVERSATION.jurisdiction("eu").getByName(conversationId);
}

/** The `Inbox` DO for one account id: its devices' WebSockets and push. */
export function inbox(env: Env, accountId: string) {
  return env.INBOX.jurisdiction("eu").getByName(accountId);
}

/** Worker secrets, which `wrangler types` cannot see (wrangler.jsonc names them). */
type Secrets = { KENNITALA_HMAC_KEY?: string; KENNI_CLIENT_SECRET?: string };

/**
 * Bound only by dev/worker.ts and test/worker.ts: the fake Kenni, reached in
 * process. A deployed Worker has no such binding and fetches the issuer.
 */
type Fake = { KENNI_FAKE?: Fetcher };

/** Kenni, the identity provider (decision 0019). */
export type Kenni = {
  issuer: string;
  clientId: string;
  /** Only for a confidential client; a native one has none. */
  clientSecret: string | undefined;
  /** The one redirect the Worker redeems a code for: the app's own scheme. */
  redirectUri: string;
  /** How the Worker reaches the issuer: the network, or the fake in process. */
  fetch: typeof fetch;
};

export function kenni(env: Env): Kenni {
  return {
    issuer: env.KENNI_ISSUER,
    clientId: ids.identity.kenniClientId,
    clientSecret: (env as Env & Secrets).KENNI_CLIENT_SECRET || undefined,
    redirectUri: `${ids.store.urlScheme}:/kenni`,
    fetch: (env as Env & Fake).KENNI_FAKE?.fetch.bind((env as Env & Fake).KENNI_FAKE) ?? fetch,
  };
}

/**
 * The key of the kennitala HMAC. A Worker without it cannot tell a returning
 * person from a new one, so it refuses to register anyone rather than guess.
 */
export function kennitalaKey(env: Env): string {
  const key = (env as Env & Secrets).KENNITALA_HMAC_KEY;
  if (!key) throw new Error("KENNITALA_HMAC_KEY is not set");
  return key;
}

/** What the association files vouch for: the apps that may open /l/ links. */
export function appLinks(env: Env): { androidFingerprints: string[]; appleAppIds: string[] } {
  const list = (text: string) =>
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  // The interim team's beta build is frozen in ids.json; the store build
  // joins it once APPLE_TEAM_ID is set.
  const interim = `${ids.appleInterim.teamId}.${ids.appleInterim.iosBundleId}`;
  const team = env.APPLE_TEAM_ID.trim();
  return {
    androidFingerprints: list(env.ANDROID_CERT_SHA256),
    appleAppIds: team ? [`${team}.${ids.store.iosBundleId}`, interim] : [interim],
  };
}
