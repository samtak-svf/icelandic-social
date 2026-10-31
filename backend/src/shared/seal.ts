import { base64url } from "./bytes.ts";

// Authenticated encryption under a key derived from a secret and a label, so that a
// value sealed for one purpose opens for no other: the sign-in flow's cookie, and
// whatever else must be stored or handed to a browser unreadable.

const encoder = new TextEncoder();

async function keyOf(secret: string, label: string) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: encoder.encode(label),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** `value` as JSON, encrypted: a fresh nonce and the sealed bytes, both base64url. */
export async function seal(secret: string, label: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await keyOf(secret, label),
    encoder.encode(JSON.stringify(value)),
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(sealed))}`;
}

const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

/** What `text` seals, or null for anything not sealed with this secret and label. */
export async function unseal<T>(secret: string, label: string, text: string): Promise<T | null> {
  const [iv, sealed] = text.split(".");
  if (!iv || !sealed || !/^[A-Za-z0-9_-]+$/.test(iv + sealed)) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64url(iv) },
      await keyOf(secret, label),
      fromBase64url(sealed),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
