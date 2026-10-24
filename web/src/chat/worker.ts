// The chat worker (decisions 0064, 0081): the only place the core runs. One
// dedicated worker per browser holds the store open; the page that owns the
// store (owner.ts) talks to it through the protocol in protocol.ts.
//
// The core's wasm is fetched with its integrity (web/integrity.ts). The
// worker's own script cannot carry one; it is served only from this host and
// listed in the published hashes.

import { getLinkedStoreKey, revokeDevice } from "../generated/api.ts";
import type { Failure } from "../generated/core.d.ts";
import { Core, init, wasm } from "virtual:spjall-core";
import { chatHost, type Share } from "./host.ts";
import { type Port, serve } from "./protocol.ts";
import { deleteSealed, loadSealed, saveSealed } from "./store-key.ts";

const OUTDATED: Failure = { code: "outdated", message: "this web app is too old for the server" };

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** The server's half of the store key, for this session's linked device. */
async function share(): Promise<Share> {
  const response = await getLinkedStoreKey();
  switch (response.status) {
    case 200:
      return { deviceId: response.data.deviceId, share: bytes(response.data.storeKeyShare) };
    case 401:
      return "signed-out";
    case 404:
      return "none";
    case 426:
      throw OUTDATED;
  }
}

async function revoke(deviceId: string): Promise<void> {
  const response = await revokeDevice({ path: { deviceId } });
  if (response.status === 426) throw OUTDATED;
}

// The core is loaded before the first message is served; a wasm file that
// does not match its integrity fails here and every call with it.
const ready = init({ module_or_path: fetch(wasm.url, { integrity: wasm.integrity }) });

const handlers = chatHost({
  open: async (key) => {
    await ready;
    return Core.open(key);
  },
  linkQr: (code) => Core.linkQr(code),
  wipeFiles: async () => {
    await ready;
    await Core.wipeStore();
  },
  keys: { load: loadSealed, save: saveSealed, delete: deleteSealed },
  share,
  revoke,
});

// A dedicated worker's global scope is its port; the web's types are the window's.
serve(self as unknown as Port, handlers);
