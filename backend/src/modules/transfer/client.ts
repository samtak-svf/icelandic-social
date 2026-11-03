import { z } from "zod";
import { transferClient } from "../../env/index.ts";
import { toHex } from "../../shared/bytes.ts";

// The exporter a person may transfer from (decision 0129), set by the maintainer as the
// TRANSFER_CLIENT secret. Only its secret's hash is kept, so the secret itself is
// nowhere in this environment. Unset or unreadable, there is no exporter and every
// transfer endpoint answers as if it did not exist.

const Client = z.object({
  id: z.string().min(1).max(200),
  /** What the person reads on the consent screen and in their list. */
  name: z.string().min(1).max(100),
  /** The SHA-256 of the client secret, in lower-case hex. */
  secretSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Compared exactly with what a request names (RFC 9700 2.1). */
  redirectUris: z.array(z.string().regex(/^https:\/\/\S+$/)).min(1),
  /** The import source its posts are recorded under, shared with an export file's. */
  source: z.string().regex(/^[a-z0-9-]{1,40}$/),
});

export type TransferClient = z.infer<typeof Client>;

/** The verticals a person can allow, as the exporter names them; photos and videos are media. */
const SCOPES = ["social-posts", "media"] as const;
export type Scope = (typeof SCOPES)[number];

const ALIASES: Record<string, Scope> = {
  "social-posts": "social-posts",
  media: "media",
  photos: "media",
  videos: "media",
};

/** The scopes a request names, or null when it names one this destination does not have. */
export function scopesOf(text: string | undefined): Scope[] | null {
  const asked = (text ?? "").split(" ").filter((word) => word !== "");
  if (asked.length === 0) return [...SCOPES];
  const scopes = new Set<Scope>();
  for (const word of asked) {
    const scope = ALIASES[word];
    if (!scope) return null;
    scopes.add(scope);
  }
  return SCOPES.filter((scope) => scopes.has(scope));
}

/** The vertical a /dtp/ path names, and the scope it needs. */
export const scopeOfVertical = (vertical: string): Scope | undefined => ALIASES[vertical];

/** The configured exporter, or null when there is none. */
export function clientOf(env: Env): TransferClient | null {
  const text = transferClient(env);
  if (!text) return null;
  try {
    const parsed = Client.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const encoder = new TextEncoder();

/** The SHA-256 of `text`, in lower-case hex: how a token or a secret is stored. */
export async function hashOf(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
}

/** Whether `presented` is the client's secret, compared in constant time over hashes. */
export async function secretMatches(client: TransferClient, presented: string): Promise<boolean> {
  const a = encoder.encode(await hashOf(presented));
  const b = encoder.encode(client.secretSha256);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}
