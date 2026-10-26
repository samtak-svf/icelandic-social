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
import { type Handlers, isFailure, type LinkOffer, type Start } from "./protocol.ts";
import {
  newStoreKey,
  type PendingLink,
  seal,
  sealPending,
  type SealedStoreKey,
  StoreKeyLost,
  unseal,
  unsealPending,
} from "./store-key.ts";

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
  groupPhoto(conversation: string): Uint8Array | null | undefined;
  setGroupPhoto(conversation: string, bytes: Uint8Array): string;
  clearGroupPhoto(conversation: string): string;
  me(): Me;
  wipe(): Promise<void>;
}

/** The server's half of the key, or why there is none. */
export type Share =
  | { deviceId: string; share: Uint8Array<ArrayBuffer> }
  /** This session has no active linked device: it was revoked, or the session is another one. */
  | "none"
  | "signed-out";

/** The server's half of a waiting link's key (0096), or why there is none. */
export type PendingShare =
  | { share: Uint8Array<ArrayBuffer> }
  /** The request is gone: expired, replaced, or completed. */
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
    /** Deletes the device's record and the waiting link's. */
    delete(): Promise<void>;
    loadPending(): Promise<PendingLink | undefined>;
    savePending(record: PendingLink): Promise<void>;
    deletePending(): Promise<void>;
  };
  share(): Promise<Share>;
  pendingShare(linkId: string): Promise<PendingShare>;
  /** Milliseconds since the epoch. */
  now(): number;
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
  /** The code of the link that waits for the phone, shown again after a reload. */
  let offer: LinkOffer | undefined;

  function forgetLinkingKey() {
    linkingKey?.fill(0);
    linkingKey = undefined;
    offer = undefined;
  }

  /**
   * Opens the store of the link this browser waits on (0096), when its request
   * still holds the server's half of the key. False when there is none to go on with.
   */
  async function resume(pending: PendingLink): Promise<boolean | "signed-out"> {
    if (pending.expiresAt <= deps.now()) return false;
    const share = await deps.pendingShare(pending.linkId);
    if (share === "signed-out") return "signed-out";
    if (share === "none") return false;
    let key: Uint8Array<ArrayBuffer>;
    try {
      key = await unsealPending(pending, share.share);
    } catch (error) {
      if (!(error instanceof StoreKeyLost)) throw error;
      return false;
    } finally {
      share.share.fill(0);
    }
    try {
      core = await deps.open(key);
    } catch (error) {
      key.fill(0);
      throw error;
    }
    linkingKey = key;
    const { code, linkId, expiresAt } = pending;
    offer = { code, linkId, expiresAt, qr: deps.linkQr(code) };
    return true;
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

  /**
   * Seals the store of the link just begun under its request's share, so a
   * reload goes on with it. The link works without: a failure here only means
   * a reload starts again.
   */
  async function keep(link: { code: string; linkId: string; expiresAt: number }) {
    const key = linkingKey;
    if (key === undefined) return;
    try {
      const share = await deps.pendingShare(link.linkId);
      if (typeof share === "string") {
        await deps.keys.deletePending();
        return;
      }
      try {
        await deps.keys.savePending(await sealPending(key, share.share, link));
      } finally {
        share.share.fill(0);
      }
    } catch {
      await deps.keys.deletePending().catch(() => undefined);
    }
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
      if (core !== undefined) return { state: "unlinked" };
      const record = await deps.keys.load();
      if (record === undefined) {
        const pending = await deps.keys.loadPending();
        if (pending !== undefined) {
          const resumed = await resume(pending);
          if (resumed === "signed-out") return { state: "signed-out" };
          if (resumed) return { state: "unlinked" };
        }
        // A link that never completed, and cannot go on, leaves files no key opens.
        await deps.wipeFiles();
        if (pending !== undefined) await deps.keys.deletePending();
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
      offer = { ...link, qr: deps.linkQr(link.code) };
      await keep(link);
      return offer;
    },

    pendingLink() {
      if (deviceId !== undefined || offer === undefined) return null;
      return offer.expiresAt > deps.now() ? offer : null;
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
      // The device's record now opens the store; one left behind is ignored by `start`.
      await deps.keys.deletePending().catch(() => undefined);
      return { deviceId: enrolled.deviceId, historyExpected: enrolled.historyExpected };
    },

    receiveHistory: () => onCore((c) => c.receiveHistory()),
    sync: () => onCore((c) => c.sync()),
    frame: (text) => onCore((c) => c.onFrame(text)),
    conversations: () => onCore((c) => c.conversations()),
    timeline: (conversation, before, limit) =>
      onCore((c) => c.timeline(conversation, before, limit)),
    send: (conversation, text) => onCore((c) => c.send(conversation, text)),
    groupPhoto: (conversation) => onCore((c) => c.groupPhoto(conversation) ?? null),
    setGroupPhoto: (conversation, bytes) => onCore((c) => c.setGroupPhoto(conversation, bytes)),
    clearGroupPhoto: (conversation) => onCore((c) => c.clearGroupPhoto(conversation)),
    me: () => onCore((c) => c.me()),

    async wipe() {
      await lose(undefined);
    },
  };
}
