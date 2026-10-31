import type { OpenAPIHono } from "@hono/zod-openapi";
import { EXCERPT_LENGTH, REF_KINDS, resolveCardsRoute } from "../../api/cards.ts";
import type { AppEnv } from "../../http.ts";
import { standing } from "../communities/index.ts";
import { commentAccess, postAccess } from "./access.ts";
import { authors } from "./bylines.ts";
import { render } from "./posts.ts";

// What a typed reference shows when shared (#288). Each kind is resolved
// through its own access check (access.ts), so a card never shows what the
// thing itself would not; anything else is the same unavailable card.

type Ref = { kind: (typeof REF_KINDS)[number]; id: string };

/** A text's first EXCERPT_LENGTH characters, an ellipsis ending one cut short. */
function excerpt(text: string): string {
  const characters = Array.from(text);
  return characters.length <= EXCERPT_LENGTH
    ? text
    : `${characters.slice(0, EXCERPT_LENGTH - 1).join("")}…`;
}

async function card(env: Env, viewer: string, ref: Ref) {
  const unavailable = { kind: "unavailable" as const, ref };
  if (ref.kind === "community") {
    const found = await standing(env, viewer, ref.id);
    // A private community's name and description are shown to the signed-in (0063).
    if (!found || found.banned) return unavailable;
    return {
      kind: "community" as const,
      ref,
      // The version is random and says nothing; fetching the picture still
      // goes through the community's read rule, so a card grants no access.
      community: { communityId: found.communityId, name: found.name, photo: found.photo },
      description: found.description,
      audience: found.audience,
      memberCount: found.memberCount,
    };
  }
  if (ref.kind === "post") {
    const found = await postAccess(env, viewer, ref.id);
    // A card names a community, and a wall has none to name (decision 0115).
    if (!found || found.access.wall) return unavailable;
    const [post] = await render(env, [found.post], found.access.viewer);
    if (!post) return unavailable;
    return {
      kind: "post" as const,
      ref,
      community: {
        communityId: post.communityId,
        name: found.access.standing.name,
        // As above: an opaque version, the image itself stays behind the read rule.
        photo: found.access.standing.photo,
      },
      author: post.author,
      excerpt: excerpt(post.body),
      image: post.media[0] ?? null,
      createdAt: post.createdAt,
    };
  }
  const found = await commentAccess(env, viewer, ref.id);
  if (!found || found.access.wall) return unavailable;
  const author = (await authors(env, [found.comment.author], found.post.communityId)).get(
    found.comment.author,
  );
  if (!author) return unavailable;
  return {
    kind: "comment" as const,
    ref,
    community: {
      communityId: found.post.communityId,
      name: found.access.standing.name,
      // As above: an opaque version, the image itself stays behind the read rule.
      photo: found.access.standing.photo,
    },
    postId: found.post.postId,
    author,
    excerpt: excerpt(found.comment.body),
    createdAt: found.comment.createdAt,
  };
}

export function cardRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(resolveCardsRoute, async (c) => {
    const viewer = c.var.session.accountId;
    const cards = await Promise.all(
      c.req.valid("json").refs.map((ref) => card(c.env, viewer, ref)),
    );
    return c.json({ cards }, 200);
  });
}
