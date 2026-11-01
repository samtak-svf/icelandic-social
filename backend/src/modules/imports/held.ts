import { openHeldPosts, type HeldFilter } from "../social/index.ts";
import { fileOf } from "./file.ts";

/**
 * Opens the held posts to `audience`; how many. Refused while posts are still coming in,
 * since the person chose from what they could see. A publish that ran out of time ends
 * failed and may have brought posts in, and those are still theirs to open.
 */
export async function openHeld(
  env: Env,
  accountId: string,
  importId: string,
  choice: HeldFilter & { audience: "friends" | "everyone" },
): Promise<number | "not_found" | "conflict"> {
  const file = await fileOf(env, accountId, importId);
  if (!file || file.removing) return "not_found";
  if (file.state !== "done" && file.state !== "failed") return "conflict";
  return openHeldPosts(env, accountId, importId, choice);
}
