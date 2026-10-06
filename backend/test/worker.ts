import worker, { Conversation as RealConversation, Inbox as RealInbox } from "../src/index.ts";
import { euEnv } from "./support.ts";

// The Worker the tests run (vitest.config.ts `main`): src/index.ts with
// every Durable Object namespace behind `euOnly`, in the Worker and in each
// Durable Object, so a request or DO-to-DO call that makes a stub any other
// way than `.jurisdiction("eu")` fails. Production code is unchanged.

export class Conversation extends RealConversation {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, euEnv(env));
  }
}

export class Inbox extends RealInbox {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, euEnv(env));
  }
}

export default {
  fetch: (request, env, ctx) => worker.fetch(request, euEnv(env), ctx),
} satisfies ExportedHandler<Env>;
