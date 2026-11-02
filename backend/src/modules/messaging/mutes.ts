import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  listMutesRoute,
  muteConversationRoute,
  unmuteConversationRoute,
} from "../../api/conversations.ts";
import type { AppEnv } from "../../http.ts";
import { inbox } from "../../env/index.ts";
import { log } from "../../shared/log.ts";
import { requireMember } from "./membership.ts";

// Muting (decision 0042): a mute is the account's, kept in its Inbox, and set
// or lifted only by a member, as media is (0023). Log lines carry ids only (0008).

export function muteRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(muteConversationRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const { accountId } = c.var.device;
    const refused = await requireMember(c, conversationId);
    if (refused) return refused;
    const mute = await inbox(c.env, accountId).mute(conversationId, c.req.valid("json").for);
    log("conversation.muted", { accountId, conversationId });
    return c.json(mute, 200);
  });

  app.openapi(unmuteConversationRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const { accountId } = c.var.device;
    const refused = await requireMember(c, conversationId);
    if (refused) return refused;
    await inbox(c.env, accountId).unmute(conversationId);
    log("conversation.unmuted", { accountId, conversationId });
    return c.body(null, 204);
  });

  app.openapi(listMutesRoute, async (c) =>
    c.json({ mutes: await inbox(c.env, c.var.device.accountId).mutes() }, 200),
  );
}
