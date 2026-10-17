import { base64url } from "../../bytes.ts";
import { db } from "../../env/index.ts";
import { UNBLOCKED } from "../../identity/index.ts";

// Names of other accounts (decisions 0022, 0034) and the directory of people
// (decision 0036).

export type Profile = {
  accountId: string;
  name: string | null;
  verified: boolean;
  photo: string | null;
};

/**
 * An account's name, mark and photo version as `viewer` sees them. Every
 * signed-in account may read any account's: everyone signed in is in the
 * directory anyway (decisions 0034, 0036, kept by 0044). A block either way withholds the
 * photo, not the name (decision 0039).
 */
export async function profile(
  env: Env,
  viewer: string,
  accountId: string,
): Promise<Profile | null> {
  const row = await db(env)
    .prepare(
      `SELECT display_name AS name, verified,
              CASE WHEN ${UNBLOCKED("?1", "?2")} THEN photo_version END AS photo
         FROM accounts WHERE account_id = ?2`,
    )
    .bind(viewer, accountId)
    .first<{ name: string | null; verified: number; photo: string | null }>();
  return row ? { accountId, name: row.name, verified: row.verified === 1, photo: row.photo } : null;
}

/** The Icelandic letters a search folds, as migrations/0010_directory.sql folds `name_key`. */
const FOLDS: [string, string][] = [
  ["á", "a"],
  ["ð", "d"],
  ["é", "e"],
  ["í", "i"],
  ["ó", "o"],
  ["ú", "u"],
  ["ý", "y"],
  ["þ", "th"],
  ["æ", "ae"],
  ["ö", "o"],
];

/**
 * A name as the directory compares it (decision 0036): lower case, with the
 * Icelandic letters folded to plain ones. SQLite's `lower` changes only
 * ASCII, so the column folds the Icelandic capitals first; this lowers first.
 */
export function nameKey(text: string): string {
  let key = text.toLowerCase();
  for (const [from, to] of FOLDS) key = key.replaceAll(from, to);
  return key;
}

/** A position in the directory: the last account's mark, name key and id. */
type DirectoryCursor = { verified: 0 | 1; key: string; id: string };

function encodeDirectoryCursor(cursor: DirectoryCursor): string {
  return base64url(
    new TextEncoder().encode(JSON.stringify([cursor.verified, cursor.key, cursor.id])),
  );
}

/** A cursor this server made, or null for anything else. */
export function decodeDirectoryCursor(text: string): DirectoryCursor | null {
  if (!/^[A-Za-z0-9_-]{1,600}$/.test(text)) return null;
  try {
    const bytes = Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [verified, key, id] = value as unknown[];
    if ((verified !== 0 && verified !== 1) || typeof key !== "string" || typeof id !== "string") {
      return null;
    }
    return { verified, key, id };
  } catch {
    return null;
  }
}

/** `%` and `_` match themselves in a LIKE pattern, under ESCAPE '\'. */
const likeLiteral = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * A page of the directory as `viewer` sees it (decision 0036): every account
 * with a name and a device the server serves, verified ones first, then by
 * name key. A search matches the start of the name key or of a word in it,
 * after a space or a hyphen (decision 0038). Leaves out the viewer, the
 * accounts it blocked and those that blocked it, since neither side could
 * start a conversation.
 */
export async function directory(
  env: Env,
  viewer: string,
  options: { query?: string; after?: DirectoryCursor; limit: number },
): Promise<{ items: Profile[]; next: string | null }> {
  const { query, after, limit } = options;
  const { results } = await db(env)
    .prepare(
      `SELECT a.account_id AS accountId, a.display_name AS name, a.verified, a.name_key AS key,
              a.photo_version AS photo
         FROM accounts a
        WHERE a.display_name IS NOT NULL
          AND a.account_id != ?1
          AND EXISTS (SELECT 1 FROM devices d
                       WHERE d.account_id = a.account_id AND d.revoked_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM blocks b
                           WHERE (b.blocker_account_id = ?1 AND b.blocked_account_id = a.account_id)
                              OR (b.blocker_account_id = a.account_id AND b.blocked_account_id = ?1))
          AND (?2 IS NULL
               OR a.name_key LIKE ?2 || '%' ESCAPE '\\'
               OR a.name_key LIKE '% ' || ?2 || '%' ESCAPE '\\'
               OR a.name_key LIKE '%-' || ?2 || '%' ESCAPE '\\')
          AND (?3 IS NULL OR a.verified < ?3
               OR (a.verified = ?3 AND (a.name_key > ?4 OR (a.name_key = ?4 AND a.account_id > ?5))))
        ORDER BY a.verified DESC, a.name_key, a.account_id
        LIMIT ?6`,
    )
    .bind(
      viewer,
      query === undefined ? null : likeLiteral(nameKey(query)),
      after?.verified ?? null,
      after?.key ?? null,
      after?.id ?? null,
      limit + 1,
    )
    .all<{
      accountId: string;
      name: string;
      verified: number;
      key: string;
      photo: string | null;
    }>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  return {
    // Blocked accounts are left out above, so every photo here may be shown.
    items: page.map((r) => ({
      accountId: r.accountId,
      name: r.name,
      verified: r.verified === 1,
      photo: r.photo,
    })),
    next:
      results.length > limit && last
        ? encodeDirectoryCursor({
            verified: last.verified === 1 ? 1 : 0,
            key: last.key,
            id: last.accountId,
          })
        : null,
  };
}
