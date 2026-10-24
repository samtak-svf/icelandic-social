// The chat worker's state (decisions 0064, 0081): which store is open, under
// which key, and what happens when it cannot open. Everything outside the
// worker (the core, IndexedDB, the API) comes in through `HostDeps`, so the
// key flow is tested without a browser.

import type {
  Conversation,
  DeviceLink,
  Enrolled,
  Failure,
  LinkQr,
  LinkState,
  Me,
  Item,
  Outcome,
} from "../generated/core.d.ts";
import { type Handlers, isFailure, type Start } from "./protocol.ts";
import { newStoreKey, seal, type SealedStoreKey, StoreKeyLost, unseal } from "./store-key.ts";

/** The part of the core's `Core` the host calls. */
export interface CoreLike {
  beginLink(): DeviceLink;
  linkState(): LinkState;
  completeLink(): Enrolled;
  receiveHistory(): number;
  sync(): Outcome;
  onFrame(text: string): Outcome;
  conversations(): Conversation[];
  timeline(conversation: string, before: number | null | undefined, limit: number): Item[];
  send(conversation: string, text: string): string;
  me(): Me;
  wipe(): Promise<void>;
}

/** The server's half of the key, or why there is none. */
export type Share =
  | { deviceId: string; share: Uint8Array<ArrayBuffer> }
  /** This session has no active linked device: it was revoked, or the session is another one. */
  | "none"
  | "signed-out";

export interface HostDeps {
  open(key: Uint8Array<ArrayBuffer>): Promise<CoreLike>;
  linkQr(code: string): LinkQr;
  /** Deletes the store's files when no core can open them. */
  wipeFiles(): Promise<void>;
  keys: {
    load(): Promise<SealedStoreKey | undefined>;
    save(record: SealedStoreKey): Promise<void>;
    delete(): Promise<void>;
  };
  share(): Promise<Share>;
  /** Revokes a device of this account; it may already be revoked. */
  revoke(deviceId: string): Promise<void>;
}

/** What a call answers once the store turned out to be lost mid-session. */
export const DEVICE_LOST: Failure = {
  code: "device-lost",
  message: "this browser's store is gone",
};

const failureCode = (error: unknown) => (isFailure(error) ? error.code : undefined);

export function chatHost(deps: HostDeps): Handlers {
  let core: CoreLike | undefined;
  let deviceId: string | undefined;
  /** The key a store being linked was opened with, kept until the link completes. */
  let linkingKey: Uint8Array<ArrayBuffer> | undefined;

  function forgetLinkingKey() {
    linkingKey?.fill(0);
    linkingKey = undefined;
  }

  /** Deletes both parts of the key and the files, and revokes the device if it is known. */
  async function lose(lostDevice: string | undefined): Promise<void> {
    const open = core;
    core = undefined;
    deviceId = undefined;
    forgetLinkingKey();
    await deps.keys.delete();
    if (open !== undefined) await open.wipe();
    else await deps.wipeFiles();
    if (lostDevice !== undefined) await deps.revoke(lostDevice).catch(() => undefined);
  }

  function opened(): CoreLike {
    if (core === undefined)
      throw { code: "closed", message: "the core is not open" } satisfies Failure;
    return core;
  }

  /** A call on the open core; a store that turns out never to have been registered is a lost device. */
  async function onCore<T>(act: (c: CoreLike) => T): Promise<T> {
    const c = opened();
    try {
      return act(c);
    } catch (error) {
      if (failureCode(error) === "not-registered" && deviceId !== undefined) {
        await lose(deviceId);
        throw DEVICE_LOST;
      }
      throw error;
    }
  }

  return {
    async start(): Promise<Start> {
      if (core !== undefined && deviceId !== undefined) return { state: "ready", deviceId };
      const record = await deps.keys.load();
      if (record === undefined) {
        // A link that never completed leaves files no key opens.
        await deps.wipeFiles();
        return { state: "unlinked" };
      }
      const share = await deps.share();
      if (share === "signed-out") return { state: "signed-out" };
      if (share === "none") {
        await lose(record.deviceId);
        return { state: "lost" };
      }
      let key: Uint8Array<ArrayBuffer>;
      try {
        key = await unseal(record, share.share, share.deviceId);
      } catch (error) {
        if (!(error instanceof StoreKeyLost)) throw error;
        await lose(record.deviceId);
        return { state: "lost" };
      } finally {
        share.share.fill(0);
      }
      // The key unsealed, so it is the store's own: a store that does not open
      // now is held by another tab's worker or out of room, not lost. Its
      // failure goes to the page and nothing is deleted. A store that is gone
      // opens empty and is found lost on the first call (`onCore`).
      try {
        core = await deps.open(key);
      } finally {
        key.fill(0);
      }
      deviceId = record.deviceId;
      return { state: "ready", deviceId };
    },

    async beginLink() {
      if (deviceId !== undefined)
        throw { code: "invalid", message: "this browser is linked" } satisfies Failure;
      if (core === undefined) {
        await deps.wipeFiles();
        const key = newStoreKey();
        core = await deps.open(key);
        linkingKey = key;
      }
      const link = core.beginLink();
      return { ...link, qr: deps.linkQr(link.code) };
    },

    linkState: () => opened().linkState(),

    async completeLink() {
      const c = opened();
      if (linkingKey === undefined)
        throw { code: "invalid", message: "no link is in progress" } satisfies Failure;
      const enrolled = c.completeLink();
      const share = new Uint8Array(enrolled.storeKeyShare);
      enrolled.storeKeyShare.fill(0);
      try {
        await deps.keys.save(await seal(linkingKey, share, enrolled.deviceId));
      } catch (error) {
        // Without the sealed key the store never opens again.
        await lose(enrolled.deviceId);
        throw error;
      } finally {
        share.fill(0);
      }
      forgetLinkingKey();
      deviceId = enrolled.deviceId;
      return { deviceId: enrolled.deviceId, historyExpected: enrolled.historyExpected };
    },

    receiveHistory: () => onCore((c) => c.receiveHistory()),
    sync: () => onCore((c) => c.sync()),
    frame: (text) => onCore((c) => c.onFrame(text)),
    conversations: () => onCore((c) => c.conversations()),
    timeline: (conversation, before, limit) =>
      onCore((c) => c.timeline(conversation, before, limit)),
    send: (conversation, text) => onCore((c) => c.send(conversation, text)),
    me: () => onCore((c) => c.me()),

    async wipe() {
      await lose(undefined);
    },
  };
}
