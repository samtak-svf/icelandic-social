//! The TypeScript the page is typed against, emitted into the generated
//! `.d.ts` by `api.rs`. It lives outside the wasm-only module so that
//! `tests/types.rs` can hold it to the shapes `dto` serializes.

/// The declarations of every value the page gets.
pub const TYPES: &str = r#"
/** What every rejected call carries. `code` is stable; `message` is a fixed sentence or a code. */
export interface Failure { code: string; message: string }
export interface Person { account: string; name: string | null; verified: boolean; photo: string | null }
export type ConversationState = "new" | "active" | "excluded" | "removed" | "left" | "stale";
export type Mute = { kind: "off" } | { kind: "until"; at: number } | { kind: "always" };
export interface Quote { envelopeId: string; sender: Person | null; text: string | null; postId: string | null; location: boolean }
export type Content =
  | { kind: "text"; text: string; replyTo: Quote | null }
  | { kind: "media"; mime: string; size: number; caption: string | null; name: string | null }
  | { kind: "deleted" }
  | { kind: "members"; added: Person[]; removed: Person[]; devices: Person[] }
  | { kind: "timer"; seconds: number | null }
  | { kind: "name"; name: string | null }
  | { kind: "photo"; set: boolean }
  | { kind: "post"; postId: string }
  | { kind: "location"; latE6: number; lonE6: number; accuracy: number | null }
  | { kind: "unreadable"; code: string };
export interface Reaction { emoji: string; own: boolean; people: Person[] }
export interface Item {
  seq: number | null; envelopeId: string | null; sender: Person; own: boolean; ts: number;
  receivedAt: number | null; status: "sent" | "pending" | "failed"; content: Content; edited: boolean;
  reactions: Reaction[]; readBy: number; expiresAt: number | null; forwarded: boolean;
}
export interface Conversation {
  id: string; state: ConversationState; name: string | null; photo: string | null; members: Person[];
  last: Item | null; unread: number; timer: number | null; mute: Mute;
}
/** The envelope body as the envelope crate writes it, tagged by `kind`. */
export type Body = { kind: string; [field: string]: unknown };
export interface Message {
  conversation: string; seq: number; senderAccount: string; senderDevice: string;
  envelope: { id: string; ts: number; body: Body }; own: boolean;
}
export type CoreEvent =
  | { kind: "message"; message: Message }
  | { kind: "membership"; conversation: string; added: string[]; removed: string[] }
  | { kind: "joined"; conversation: string }
  | { kind: "devices"; conversation: string; joined: { account: string; device: string }[] }
  | { kind: "removed"; conversation: string }
  | { kind: "stale"; conversation: string }
  | { kind: "typing"; conversation: string; active: boolean }
  | { kind: "timeline"; conversation: string; changed: number[] }
  | { kind: "profiles"; accounts: string[] }
  | { kind: "expired"; conversation: string; removed: number[] }
  | { kind: "caughtUp" };
export interface Outcome { events: CoreEvent[]; frames: string[] }
export interface Me {
  accountId: string; name: string | null; verified: boolean; photo: string | null;
  suspension: { until: number | null } | null; platformModerator: boolean;
  devices: { deviceId: string; platform: "android" | "ios"; kind: "phone" | "web"; createdAt: number; current: boolean }[];
}
export interface DeviceLink { code: string; linkId: string; expiresAt: number }
export type LinkState = "pending" | "approved" | "expired";
export interface Enrolled { accountId: string; deviceId: string; historyExpected: boolean; storeKeyShare: Uint8Array }
export interface LinkQr { size: number; modules: Uint8Array }
"#;
