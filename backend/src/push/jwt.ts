import { base64url, fromBase64 } from "../bytes.ts";

// JSON Web Tokens for the push providers, signed with WebCrypto (decision
// 0025): RS256 for Google's OAuth token, ES256 for an APNs provider token.

const encoder = new TextEncoder();
const part = (value: object) => base64url(encoder.encode(JSON.stringify(value)));

const ALGORITHMS = {
  RS256: {
    importAs: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    signAs: { name: "RSASSA-PKCS1-v1_5" },
  },
  ES256: {
    importAs: { name: "ECDSA", namedCurve: "P-256" },
    signAs: { name: "ECDSA", hash: "SHA-256" },
  },
} as const;

/** The DER inside a PEM private key ("-----BEGIN PRIVATE KEY-----", PKCS #8). */
function pkcs8(pem: string): Uint8Array {
  return fromBase64(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""));
}

const keys = new Map<string, Promise<CryptoKey>>();

/** A signed JWT. The key is imported once per isolate. */
export async function signJwt(
  alg: keyof typeof ALGORITHMS,
  pem: string,
  header: Record<string, string>,
  claims: Record<string, string | number>,
): Promise<string> {
  const { importAs, signAs } = ALGORITHMS[alg];
  const cacheKey = `${alg}:${pem}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = crypto.subtle.importKey("pkcs8", pkcs8(pem), importAs, false, ["sign"]);
    keys.set(cacheKey, key);
  }
  const input = `${part({ alg, typ: "JWT", ...header })}.${part(claims)}`;
  // WebCrypto's ECDSA signature is r || s, which is what JWS wants.
  const signature = await crypto.subtle.sign(signAs, await key, encoder.encode(input));
  return `${input}.${base64url(new Uint8Array(signature))}`;
}
