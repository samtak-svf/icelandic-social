import { assistantCommunity } from "../../env/index.ts";
import { job } from "./queue.ts";

// The job that has the testers' assistant read a comment (decision 0076).
// The route that writes a comment writes it; the assistant module runs it.

/** The job of a comment in the assistant's community, keyed by the comment: none elsewhere. */
export function askAssistant(
  env: Env,
  communityId: string,
  commentId: string,
): D1PreparedStatement[] {
  if (communityId !== assistantCommunity(env)) return [];
  return [job(env, { kind: "assistant", key: `assistant:${commentId}`, payload: { commentId } })];
}
