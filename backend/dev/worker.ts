import { tokenHash } from "../src/accounts.ts";
import worker, { Conversation as RealConversation, Inbox as RealInbox } from "../src/index.ts";

// The Worker that `wrangler dev dev/worker.ts` runs for the interop test
// (core/client/tests/backend.rs). Never deployed: `wrangler deploy` reads
// `main` from wrangler.jsonc, which stays src/index.ts.
//
// It differs from the real Worker in two ways only:
// - local workerd throws on `jurisdiction()`, so each namespace answers
//   `.jurisdiction("eu")` with itself (test/worker.ts refuses anything else);
// - `POST /dev/devices` registers a device without Kenni, which does not
//   exist yet, and returns its token.

function local(namespace: DurableObjectNamespace): DurableObjectNamespace {
  return new Proxy(namespace, {
    get(target, key) {
      if (key === "jurisdiction") {
        return (jurisdiction: string) => {
          if (jurisdiction !== "eu") throw new Error(`stub pinned to ${jurisdiction}, not eu`);
          return target;
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function devEnv(env: Env): Env {
  return {
    ...env,
    CONVERSATION: local(env.CONVERSATION) as Env["CONVERSATION"],
    INBOX: local(env.INBOX) as Env["INBOX"],
  };
}

export class Conversation extends RealConversation {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, devEnv(env));
  }
}

export class Inbox extends RealInbox {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, devEnv(env));
  }
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** `{accountId, deviceId, devicePublic}` (base64 Ed25519 key) → `{token}`. */
async function register(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const { accountId, deviceId, devicePublic } = body;
  if (typeof accountId !== "string" || !ID.test(accountId))
    return new Response(null, { status: 400 });
  if (typeof deviceId !== "string" || !ID.test(deviceId))
    return new Response(null, { status: 400 });
  if (typeof devicePublic !== "string") return new Response(null, { status: 400 });
  const key = Uint8Array.from(atob(devicePublic), (c) => c.charCodeAt(0));
  const token = `dt_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO accounts (account_id, created_at) VALUES (?, ?)").bind(
      accountId,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO devices (device_id, account_id, platform, device_key, token_hash, created_at)
       VALUES (?, ?, 'android', ?, ?, ?)`,
    ).bind(deviceId, accountId, key, await tokenHash(token), now),
  ]);
  return Response.json({ token });
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/dev/devices") return register(request, env);
    return worker.fetch(request, devEnv(env), ctx);
  },
} satisfies ExportedHandler<Env>;
