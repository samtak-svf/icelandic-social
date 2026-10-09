// The seam: the only module that reads bindings, vars and secrets, and the
// only place a Durable Object stub is made (tooling/seam-guard.mjs).
//
// Every stub is pinned to the EU jurisdiction per object id. A DO namespace
// has no jurisdiction of its own, so a bare `idFromName` would create the
// object wherever Cloudflare chose and could never be moved (decision 0001).

import ids from "../../../identifiers/ids.json" with { type: "json" };
import { log } from "../log.ts";
import type { Conversation } from "../do/conversation.ts";
import type { Inbox } from "../do/inbox.ts";
import type { ApnsKey } from "../push/apns.ts";
import type { FcmAccount } from "../push/fcm.ts";

// `cf workers types` types a Durable Object binding by its class only when the
// config holds the Worker's module, and cloudflare.config.ts names its own
// Worker by name. The classes are given here, next to the stubs.
declare global {
  namespace Cloudflare {
    interface Env {
      CONVERSATION: DurableObjectNamespace<Conversation>;
      INBOX: DurableObjectNamespace<Inbox>;
    }
  }
}

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
 * before signing in, per account on key-package claims (cloudflare.config.ts).
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

/** Worker secrets, which `cf workers types` cannot see (cloudflare.config.ts names them). */
type Secrets = {
  KENNITALA_HMAC_KEY?: string;
  KENNITALA_HMAC_KEY_PREVIOUS?: string;
  KENNI_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FCM_SERVICE_ACCOUNT?: string;
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
};

/**
 * Bound only by dev/worker.ts and test/worker.ts: the fake Kenni and Google,
 * reached in process. A deployed Worker has no such binding and fetches the
 * issuer.
 */
type Fake = { KENNI_FAKE?: Fetcher; GOOGLE_FAKE?: Fetcher };

/** The ways to sign in (decision 0033). */
export type ProviderName = "kenni" | "google";

/** An OpenID Connect provider the Worker redeems codes at (decisions 0019, 0033). */
export type IdentityProvider = {
  name: ProviderName;
  issuer: string;
  /** What an ID token's `iss` may be: the issuer, and for Google its bare host. */
  issuers: string[];
  clientId: string;
  /** Only for a confidential client: Google's web client has one, Kenni's native one none. */
  clientSecret: string | undefined;
  /** The one redirect the Worker redeems a code for. */
  redirectUri: string;
  scope: string;
  /** How the Worker reaches the issuer: the network, or the fake in process. */
  fetch: typeof fetch;
};

// Wrapped, not stored: workerd refuses its fetch called as a method of
// another object ("Illegal invocation").
function reach(fake: Fetcher | undefined): typeof fetch {
  return fake?.fetch.bind(fake) ?? ((input, init) => fetch(input, init));
}

/** Kenni, which signs in and verifies a name (decisions 0019, 0033). */
export function kenni(env: Env): IdentityProvider {
  return {
    name: "kenni",
    issuer: env.KENNI_ISSUER,
    issuers: [env.KENNI_ISSUER],
    clientId: ids.identity.kenniClientId,
    clientSecret: (env as Env & Secrets).KENNI_CLIENT_SECRET || undefined,
    // The app's own scheme.
    redirectUri: `${ids.store.urlScheme}:/kenni`,
    scope: "openid national_id audkenni_name",
    fetch: reach((env as Env & Fake).KENNI_FAKE),
  };
}

/**
 * Google, the first way to sign in (decision 0033), or null until both its
 * client id and secret are set. Google refuses a custom scheme for a web
 * client, so the code comes back through the link host's /oauth/google.
 */
export function google(env: Env): IdentityProvider | null {
  const clientId = env.GOOGLE_CLIENT_ID.trim();
  const clientSecret = (env as Env & Secrets).GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const issuer = env.GOOGLE_ISSUER;
  return {
    name: "google",
    issuer,
    // Google's tokens carry either form (its OpenID Connect documentation).
    issuers: [issuer, issuer.replace(/^https:\/\//, "")],
    clientId,
    clientSecret,
    redirectUri: `https://${ids.hosts.link}/oauth/google`,
    scope: "openid email profile",
    fetch: reach((env as Env & Fake).GOOGLE_FAKE),
  };
}

/** A provider by name, or null when it is not configured. */
export function identityProvider(env: Env, name: ProviderName): IdentityProvider | null {
  return name === "kenni" ? kenni(env) : google(env);
}

/**
 * The keys of the kennitala HMAC: the current one, and while a rotation runs,
 * the one before it. A Worker without a key cannot tell a returning person
 * from a new one, so it refuses to register anyone rather than guess.
 */
export function kennitalaKeys(env: Env): { key: string; previous: string | null } {
  const secrets = env as Env & Secrets;
  if (!secrets.KENNITALA_HMAC_KEY) throw new Error("KENNITALA_HMAC_KEY is not set");
  return { key: secrets.KENNITALA_HMAC_KEY, previous: secrets.KENNITALA_HMAC_KEY_PREVIOUS || null };
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

/** The push providers' credentials (decision 0025); each is absent until set. */
export type PushConfig = { fcm?: FcmAccount; apns?: ApnsKey; fetch: typeof fetch };

/**
 * FCM from the `FCM_SERVICE_ACCOUNT` secret (the service account's JSON key);
 * APNs from the `APNS_KEY_P8` and `APNS_KEY_ID` secrets and the
 * `APNS_TEAM_ID` and `APNS_TOPIC` vars. A malformed key is logged and left
 * out, so push stays off rather than failing every notify.
 */
export function pushConfig(env: Env): PushConfig {
  const secrets = env as Env & Secrets;
  const config: PushConfig = { fetch };
  if (secrets.FCM_SERVICE_ACCOUNT) {
    try {
      const key = JSON.parse(secrets.FCM_SERVICE_ACCOUNT) as Record<string, unknown>;
      const { project_id, client_email, private_key, token_uri } = key;
      if (
        typeof project_id !== "string" ||
        typeof client_email !== "string" ||
        typeof private_key !== "string"
      ) {
        throw new Error("fields");
      }
      config.fcm = {
        projectId: project_id,
        clientEmail: client_email,
        privateKey: private_key,
        tokenUri: typeof token_uri === "string" ? token_uri : "https://oauth2.googleapis.com/token",
      };
    } catch {
      log("push.misconfigured", { code: "fcm" });
    }
  }
  const teamId = env.APNS_TEAM_ID.trim();
  const topic = env.APNS_TOPIC.trim();
  if (secrets.APNS_KEY_P8 && secrets.APNS_KEY_ID) {
    if (teamId && topic) {
      config.apns = { keyId: secrets.APNS_KEY_ID, teamId, privateKey: secrets.APNS_KEY_P8, topic };
    } else {
      log("push.misconfigured", { code: "apns" });
    }
  }
  return config;
}
