import type { ChatCall } from "./protocol.ts";
import { isFailure } from "./protocol.ts";

// The four changes a member makes to a group (decision 0078), each one call to
// the core through the worker. The core queues a change like a message, so the
// page syncs after it; what went wrong is one of two sentences, as a send's is.

/** What a change asks for. */
export type GroupChange =
  | { kind: "add"; accounts: string[] }
  | { kind: "remove"; account: string }
  /** `null` clears the name; the core also treats a blank one so. */
  | { kind: "rename"; name: string | null }
  | { kind: "leave" };

/** Why a change did not happen: the network, or anything else. Neither is told apart further. */
export type GroupProblem = "unreachable" | "failed";

/** The longest a group's name may be (0078): a title, not a sentence. */
export const NAME_LIMIT = 64;

/** The problem a failed change shows. */
export function groupProblem(error: unknown): GroupProblem {
  return isFailure(error) && error.code === "unreachable" ? "unreachable" : "failed";
}

/** What the name field holds, as the core takes it: trimmed, and none when blank. */
export function nameOf(draft: string): string | null {
  const name = draft.trim();
  return name === "" ? null : name;
}

/** Makes the change, or says why it did not happen. */
export async function changeGroup(
  call: ChatCall,
  conversation: string,
  change: GroupChange,
): Promise<GroupProblem | null> {
  try {
    switch (change.kind) {
      case "add":
        await call("addAccounts", conversation, change.accounts);
        break;
      case "remove":
        await call("removeAccounts", conversation, [change.account]);
        break;
      case "rename":
        await call("rename", conversation, change.name);
        break;
      case "leave":
        await call("leave", conversation);
        break;
    }
    return null;
  } catch (error) {
    return groupProblem(error);
  }
}
