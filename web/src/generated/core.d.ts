/* tslint:disable */
/* eslint-disable */

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
    reactions: Reaction[]; readBy: number; readHere: Person[]; expiresAt: number | null; forwarded: boolean;
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



/**
 * The core of one signed-in or linking browser.
 */
export class Core {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adds every device of these accounts to a group (0078), on the next
     * sync. People are picked from the directory, as a new group's are.
     */
    addAccounts(conversation_id: string, accounts: string[]): void;
    beginLink(): DeviceLink;
    /**
     * Takes a group's photo away (0094); the envelope id.
     */
    clearGroupPhoto(conversation_id: string): string;
    /**
     * `{ accountId, deviceId, historyExpected, storeKeyShare: Uint8Array }`.
     */
    completeLink(): Enrolled;
    conversations(): Conversation[];
    /**
     * The JPEG of this device's copy of a group's photo, `null` when it has
     * none (0094).
     */
    groupPhoto(conversation_id: string): Uint8Array | null;
    /**
     * Leaves a group (0078): the server stops listing this account and the
     * conversation is `left`. Leaving again is done already.
     */
    leave(conversation_id: string): void;
    /**
     * `{ size, modules: Uint8Array }` for the page to draw.
     */
    static linkQr(code: string): LinkQr;
    linkState(): LinkState;
    /**
     * Everything up to the item `seq` is on screen (0022): moves this
     * account's mark, and with read markers on queues the receipt the next
     * sync sends.
     */
    markRead(conversation_id: string, seq: number): void;
    me(): Me;
    /**
     * A frame the realtime socket delivered.
     */
    onFrame(text: string): Outcome;
    /**
     * Installs the pool once, opens the store and the blobs under `key`, and
     * builds the client. Only in a dedicated Worker.
     */
    static open(key: Uint8Array): Promise<Core>;
    /**
     * The number of messages imported from the approving phone's history.
     */
    receiveHistory(): number;
    /**
     * Takes these accounts out of a group (0078), on the next sync. This
     * account is refused: leaving is `leave`.
     */
    removeAccounts(conversation_id: string, accounts: string[]): void;
    /**
     * Names a group, or clears its name with `null` or a blank one (0078);
     * the envelope id. `not-a-group` for a conversation of two,
     * `name-invalid` past 64 characters or with a control character.
     */
    rename(conversation_id: string, name?: string | null): string;
    /**
     * Queues a text message; the envelope id.
     */
    send(conversation_id: string, text: string): string;
    /**
     * Gives a group a photo (0094) from the bytes of a JPEG, PNG or WebP
     * file; the core makes the square JPEG. The envelope id.
     */
    setGroupPhoto(conversation_id: string, bytes: Uint8Array): string;
    /**
     * `sync` for one conversation alone, as the apps call it after a send (0099).
     */
    syncConversation(conversation: string): Outcome;
    sync(): Outcome;
    /**
     * Up to `limit` items before the item `before` (a seq), oldest first:
     * what a thread shows, the history a linked phone sent included. The
     * newest page ends with what is still being sent.
     */
    timeline(conversation_id: string, before: number | null | undefined, limit: number): Item[];
    /**
     * Deletes the pool's files without opening a store: what is left when
     * no key opens it, after a link that never completed or a key that is
     * gone (0064). Nothing may hold the pool open.
     */
    static wipeStore(): Promise<void>;
    /**
     * Deletes everything: the store, the blobs and the pool. Consumes the
     * object, since the pool refuses while a connection is open.
     */
    wipe(): Promise<void>;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_core_free: (a: number, b: number) => void;
    readonly core_addAccounts: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly core_beginLink: (a: number, b: number) => void;
    readonly core_clearGroupPhoto: (a: number, b: number, c: number, d: number) => void;
    readonly core_completeLink: (a: number, b: number) => void;
    readonly core_conversations: (a: number, b: number) => void;
    readonly core_groupPhoto: (a: number, b: number, c: number, d: number) => void;
    readonly core_leave: (a: number, b: number, c: number, d: number) => void;
    readonly core_linkQr: (a: number, b: number, c: number) => void;
    readonly core_linkState: (a: number, b: number) => void;
    readonly core_markRead: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly core_me: (a: number, b: number) => void;
    readonly core_onFrame: (a: number, b: number, c: number, d: number) => void;
    readonly core_open: (a: number, b: number) => number;
    readonly core_receiveHistory: (a: number, b: number) => void;
    readonly core_removeAccounts: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly core_rename: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly core_send: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly core_setGroupPhoto: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly core_sync: (a: number, b: number) => void;
    readonly core_syncConversation: (a: number, b: number, c: number, d: number) => void;
    readonly core_timeline: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly core_wipe: (a: number) => number;
    readonly core_wipeStore: () => number;
    readonly rust_sqlite_wasm_abort: () => void;
    readonly rust_sqlite_wasm_assert_fail: (a: number, b: number, c: number, d: number) => void;
    readonly rust_sqlite_wasm_calloc: (a: number, b: number) => number;
    readonly rust_sqlite_wasm_free: (a: number) => void;
    readonly rust_sqlite_wasm_getentropy: (a: number, b: number) => number;
    readonly rust_sqlite_wasm_localtime: (a: number) => number;
    readonly rust_sqlite_wasm_malloc: (a: number) => number;
    readonly rust_sqlite_wasm_realloc: (a: number, b: number) => number;
    readonly sqlite3_os_end: () => number;
    readonly sqlite3_os_init: () => number;
    readonly __wasm_bindgen_func_elem_6801: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_6816: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
