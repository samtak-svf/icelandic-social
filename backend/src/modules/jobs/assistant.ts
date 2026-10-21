import { assistantCommunity } from "../../env/index.ts";
import { job } from "./queue.ts";

// The job that has the testers' assistant read a post or a comment (decision
// 0076). The route that writes it writes the job; the assistant module runs it.

/** The job of a post or comment in the assistant's community, keyed by its id: none elsewhere. */
export function askAssistant(env: Env, communityId: string, saidId: string): D1PreparedStatement[] {
  if (communityId !== assistantCommunity(env)) return [];
  return [job(env, { kind: "assistant", key: `assistant:${saidId}`, payload: { saidId } })];
}
