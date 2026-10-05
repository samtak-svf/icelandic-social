// The seam: the only module that reads bindings, vars and secrets, and the
// only place a Durable Object stub is made (tooling/seam-guard.mjs).
//
// Every stub is pinned to the EU jurisdiction per object id. A DO namespace
// has no jurisdiction of its own, so a bare `idFromName` would create the
// object wherever Cloudflare chose and could never be moved (decision 0001).

/** The platforms a client build can report; each has its own minimum version. */
export type Platform = "android" | "ios";

export function minClientVersions(env: Env): Record<Platform, string> {
  return {
    android: env.MIN_CLIENT_VERSION_ANDROID,
    ios: env.MIN_CLIENT_VERSION_IOS,
  };
}

/** The `Conversation` DO for one conversation id: its MLS delivery service. */
export function conversation(env: Env, conversationId: string) {
  return env.CONVERSATION.jurisdiction("eu").getByName(conversationId);
}

/** The `Inbox` DO for one account id: its devices' WebSockets and push. */
export function inbox(env: Env, accountId: string) {
  return env.INBOX.jurisdiction("eu").getByName(accountId);
}
