import { db } from "../../env/index.ts";
import { commentMedia } from "./media.ts";
import type { CommentContent } from "./do/space.ts";

// The bylines of posts and comments (decision 0080): a name, a mark, a photo
// version and the role in the community the content belongs to, read in one
// query however many communities a page spans.

export type Author = {
  accountId: string;
  name: string | null;
  verified: boolean;
  photo: string | null;
  /** The role in the community the content belongs to; null for a member or none in context. */
  role: "owner" | "moderator" | null;
};
/**
 * The bylines of `pairs` (an account and the community its content belongs
 * to, or null where none is in context), keyed by `bylineKey`, in one query:
 * name, mark, photo version and, with a community, the role there. A role is
 * only ever the one in that pair's own community. An account deleted since
 * is left out.
 */
export async function bylines(
  env: Env,
  pairs: { accountId: string; communityId: string | null }[],
): Promise<Map<string, Author>> {
  const unique = [
    ...new Map(pairs.map((p) => [bylineKey(p.accountId, p.communityId), p])).values(),
  ];
  if (unique.length === 0) return new Map();
  const { results } = await db(env)
    .prepare(
      `SELECT a.account_id AS accountId, a.display_name AS name, a.verified,
              a.photo_version AS photo, j.community AS communityId, m.role
         FROM (SELECT json_extract(value, '$[0]') AS account,
                      json_extract(value, '$[1]') AS community
                 FROM json_each(?)) j
         JOIN accounts a ON a.account_id = j.account
         LEFT JOIN community_members m
                ON m.community_id = j.community AND m.account_id = j.account`,
    )
    .bind(JSON.stringify(unique.map((p) => [p.accountId, p.communityId])))
    .all<{
      accountId: string;
      name: string | null;
      verified: number;
      photo: string | null;
      communityId: string | null;
      role: "owner" | "moderator" | "member" | null;
    }>();
  return new Map(
    results.map((r) => [
      bylineKey(r.accountId, r.communityId),
      {
        accountId: r.accountId,
        name: r.name,
        verified: r.verified === 1,
        photo: r.photo,
        role: r.role === "owner" || r.role === "moderator" ? r.role : null,
      },
    ]),
  );
}

export const bylineKey = (accountId: string, communityId: string | null) =>
  `${communityId ?? ""}|${accountId}`;

/**
 * The names and marks of `ids`; an account deleted since is left out. With
 * `communityId`, each carries its role in that community.
 */
export async function authors(
  env: Env,
  ids: string[],
  communityId?: string,
): Promise<Map<string, Author>> {
  const found = await bylines(
    env,
    ids.map((accountId) => ({ accountId, communityId: communityId ?? null })),
  );
  return new Map([...found.values()].map((a) => [a.accountId, a]));
}

/** Comments with their authors' bylines in `communityId`; a deleted author's go. */
export async function named(env: Env, comments: CommentContent[], communityId: string) {
  const names = await authors(
    env,
    comments.map((c) => c.author),
    communityId,
  );
  const media = await commentMedia(
    env,
    comments.map((c) => c.commentId),
  );
  return comments.flatMap((c) => {
    // A tombstone's slot (decision 0071): its author is gone and its body
    // never reaches an ordinary reader, only its place in the thread.
    if (c.author === "") {
      return [
        {
          ...c,
          author: { accountId: "deleted", name: null, verified: false, photo: null, role: null },
          body: "",
          state: "removed" as const,
          media: [],
        },
      ];
    }
    const author = names.get(c.author);
    return author ? [{ ...c, author, media: media.get(c.commentId) ?? [] }] : [];
  });
}
