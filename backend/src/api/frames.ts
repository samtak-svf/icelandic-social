import { z } from "@hono/zod-openapi";

// WebSocket frames: one union tagged by `type` (decision 0005). Swift decodes
// the generated union; Kotlin gets a sealed interface from
// tooling/ws-kotlin.mjs, because openapi-generator cannot decode it.
//
// Each member is a named component with a literal `type`. Only the shapes the
// emitter maps are allowed: string, integer, number, boolean, arrays of those,
// and optional fields. Binary is base64 text, never `format: byte`.

const ConversationId = z.string().min(1);

export const HelloFrame = z
  .object({
    type: z.literal("hello"),
    protocol: z.int().min(1).openapi({ description: "Protocol version the server speaks" }),
    serverTime: z.iso.datetime(),
  })
  .openapi("HelloFrame", { description: "Server to client, first frame on a new socket" });

export const NotifyFrame = z
  .object({
    type: z.literal("notify"),
    conversationId: ConversationId,
    seq: z.int().min(0).openapi({ description: "The newest sequence number in the conversation" }),
  })
  .openapi("NotifyFrame", {
    description: "Server to client: a conversation has messages up to `seq`; fetch them",
  });

export const PingFrame = z
  .object({ type: z.literal("ping"), nonce: z.string().optional() })
  .openapi("PingFrame", { description: "Either direction; answered with `pong`" });

export const PongFrame = z
  .object({ type: z.literal("pong"), nonce: z.string().optional() })
  .openapi("PongFrame", { description: "The answer to `ping`, echoing its nonce" });

export const WsFrame = z
  .discriminatedUnion("type", [HelloFrame, NotifyFrame, PingFrame, PongFrame])
  .openapi("WsFrame", { description: "Every frame on the WebSocket, tagged by `type`" });

export type WsFrame = z.infer<typeof WsFrame>;
