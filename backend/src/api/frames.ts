import { z } from "@hono/zod-openapi";
import { base64, OpaqueId } from "./common.ts";

// WebSocket frames: one union tagged by `type` (decisions 0005, 0015). Swift decodes
// the generated union; Kotlin gets a sealed interface from
// tooling/ws-kotlin.mjs, because openapi-generator cannot decode it.
//
// Each member is a named component with a literal `type`. Only the shapes the
// emitter maps are allowed: string, integer, number, boolean, arrays of those,
// and optional fields. Binary is base64 text, never `format: byte`.

const ConversationId = OpaqueId;

const HelloFrame = z
  .object({
    type: z.literal("hello"),
    protocol: z.int().min(1).openapi({ description: "Protocol version the server speaks" }),
    serverTime: z.iso.datetime(),
  })
  .openapi("HelloFrame", { description: "Server to client, first frame on a new socket" });

const NotifyFrame = z
  .object({
    type: z.literal("notify"),
    conversationId: ConversationId,
    seq: z.int().min(0).openapi({ description: "The newest sequence number in the conversation" }),
  })
  .openapi("NotifyFrame", {
    description: "Server to client: a conversation has messages up to `seq`; fetch them",
  });

const AckFrame = z
  .object({
    type: z.literal("ack"),
    conversationId: ConversationId,
    seq: z.int().min(0).openapi({ description: "This device has stored everything up to here" }),
  })
  .openapi("AckFrame", { description: "Client to server: moves this device's delivery cursor" });

const TypingFrame = z
  .object({
    type: z.literal("typing"),
    conversationId: ConversationId,
    ciphertext: base64(4096).openapi({
      description: "An MLS message whose envelope kind is typing",
    }),
  })
  .openapi("TypingFrame", {
    description: "Either direction: an encrypted typing indicator, relayed and never stored",
  });

const PingFrame = z
  .object({ type: z.literal("ping"), nonce: z.string().optional() })
  .openapi("PingFrame", { description: "Either direction; answered with `pong`" });

const PongFrame = z
  .object({ type: z.literal("pong"), nonce: z.string().optional() })
  .openapi("PongFrame", { description: "The answer to `ping`, echoing its nonce" });

export const WsFrame = z
  .discriminatedUnion("type", [
    HelloFrame,
    NotifyFrame,
    AckFrame,
    TypingFrame,
    PingFrame,
    PongFrame,
  ])
  .openapi("WsFrame", { description: "Every frame on the WebSocket, tagged by `type`" });

export type WsFrame = z.infer<typeof WsFrame>;
