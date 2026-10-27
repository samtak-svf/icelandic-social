import { commentAccess, postAccess } from "../social/index.ts";
import { space } from "../../env/index.ts";

// What a notification quotes (decision 0105): read when the page is, never
// stored, so a removed comment or a lost access leaves nothing behind.

/** The longest quote, in graphemes. */
const MAX_GRAPHEMES = 100;

const segmenter = new Intl.Segmenter();

/** `text` with its whitespace collapsed, cut at 100 graphemes with an ellipsis. */
function quote(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const graphemes = [...segmenter.segment(flat)];
  if (graphemes.length <= MAX_GRAPHEMES) return flat;
  return `${graphemes
    .slice(0, MAX_GRAPHEMES)
    .map((g) => g.segment)
    .join("")}…`;
}

type Quoted = { kind: string; postId: string | null; commentId: string | null };

/** The text `row` quotes for `viewer`, or null if there is none or the viewer may not read it. */
export async function snippetOf(env: Env, viewer: string, row: Quoted): Promise<string | null> {
  if ((row.kind === "comment" || row.kind === "reply") && row.commentId) {
    const found = await commentAccess(env, viewer, row.commentId);
    return found?.comment.state === "visible" ? quote(found.comment.body) : null;
  }
  if (row.kind === "reaction" && row.postId) {
    const found = await postAccess(env, viewer, row.postId);
    if (!found) return null;
    const [content] = await space(env, found.post.communityId).posts(
      [row.postId],
      found.access.viewer,
    );
    return content ? quote(content.body) : null;
  }
  return null;
}
