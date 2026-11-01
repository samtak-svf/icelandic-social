// Binary data as the contract and the conversation ids carry it.

/** Standard base64 text to bytes; the schema has already checked its shape. */
export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Lower-case hex, two digits a byte: stored hashes and ids are this text, so it must not change. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `size` random bytes as hex. */
export const randomHex = (size: number): string =>
  toHex(crypto.getRandomValues(new Uint8Array(size)));

/** Unpadded base64url, the form of a group id as a conversation id (decision 0017). */
export function base64url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
