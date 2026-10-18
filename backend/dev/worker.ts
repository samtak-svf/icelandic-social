import { web } from "spjall-web/server";
import { withFakes } from "./oidc.ts";
import { API_PATHS } from "../src/index.ts";
import worker, {
  Conversation as RealConversation,
  Inbox as RealInbox,
  Space as RealSpace,
} from "../src/worker.ts";
import { OPERATOR_INVITE_PATH, operatorInvite } from "../scripts/operator-invite.ts";

// The Worker that `cf dev --mode interop` runs for the interop test
// (core/client/tests/backend.rs) and the web's Playwright run (web/e2e/), with
// the web app on every path the API does not own, as in src/index.ts. Never
// deployed: every other mode's entry is
// src/index.ts (cloudflare.config.ts), and `jurisdiction-check.mjs --deploy`
// refuses any other.
//
// It differs from the real Worker in these ways only:
// - local workerd throws on `jurisdiction()`, so each namespace answers
//   `.jurisdiction("eu")` with itself (test/worker.ts refuses anything else);
// - it serves the fake Kenni and Google (dev/oidc.ts) under /dev/kenni and
//   /dev/google and reaches them in process; the interop mode sets
//   KENNI_ISSUER, GOOGLE_ISSUER and GOOGLE_CLIENT_ID to them;
// - a POST to /dev/operator-invite writes an operator invite into the local D1
//   and answers its link (scripts/invite-operator.ts --local), since cf has no
//   local `d1 query`;
// - a POST to /dev/jobs runs the minute cron once (decision 0067), since local
//   cf dev fires no cron, so a test sees its notification at once.

const JOBS_PATH = "/dev/jobs";

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
    SPACE: local(env.SPACE) as Env["SPACE"],
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

export class Space extends RealSpace {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, devEnv(env));
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const fakes = withFakes(request, env);
    if (fakes.response) return fakes.response;
    if (url.pathname === OPERATOR_INVITE_PATH && request.method === "POST") {
      const { link, sql } = await operatorInvite();
      await env.DB.prepare(sql).run();
      return new Response(link);
    }
    if (url.pathname === JOBS_PATH && request.method === "POST") {
      const cron = { cron: "* * * * *", scheduledTime: Date.now(), noRetry() {} };
      await worker.scheduled(cron, devEnv(env));
      return new Response(null, { status: 204 });
    }
    if (!API_PATHS.test(url.pathname)) return web(request);
    return worker.fetch(request, { ...devEnv(env), ...fakes.env }, ctx);
  },
} satisfies ExportedHandler<Env>;
