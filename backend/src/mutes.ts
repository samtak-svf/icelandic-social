import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  listMutesRoute,
  muteConversationRoute,
  unmuteConversationRoute,
} from "./api/conversations.ts";
import type { AppEnv } from "./app.ts";
import { conversation, inbox } from "./env/index.ts";
import { fail } from "./errors.ts";
import { log } from "./log.ts";

// Muting (decision 0042): a mute is the account's, kept in its Inbox, and set
// or lifted only by a member, as media is (0023). Log lines carry ids only (0008).

export function muteRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(muteConversationRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const { accountId } = c.var.device;
    const member = await conversation(c.env, conversationId).member(accountId);
    if ("error" in member) {
      return member.error === "not_found"
        ? fail(c, 404, member.error)
        : fail(c, 403, "not_a_member");
    }
    const mute = await inbox(c.env, accountId).mute(conversationId, c.req.valid("json").for);
    log("conversation.muted", { accountId, conversationId });
    return c.json(mute, 200);
  });

  app.openapi(unmuteConversationRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const { accountId } = c.var.device;
    const member = await conversation(c.env, conversationId).member(accountId);
    if ("error" in member) {
      return member.error === "not_found"
        ? fail(c, 404, member.error)
        : fail(c, 403, "not_a_member");
    }
    await inbox(c.env, accountId).unmute(conversationId);
    log("conversation.unmuted", { accountId, conversationId });
    return c.body(null, 204);
  });

  app.openapi(listMutesRoute, async (c) =>
    c.json({ mutes: await inbox(c.env, c.var.device.accountId).mutes() }, 200),
  );
}
