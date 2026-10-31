import type { listFriendSuggestions, Profile } from "../generated/api.ts";
import { outcome, type Outcome } from "./outcome.ts";
import type { Page } from "./paged.ts";

// The suggested people on the friends list (decision 0114): read a page at a
// time through the paged helper, which speaks of `posts`, and shown only while
// the account takes part.

/** One page of suggestions, in the shape the paged helper reads. */
export async function suggestionPage(
  list: (args: { query: { after?: string } }) => ReturnType<typeof listFriendSuggestions>,
  after: string | undefined,
): Promise<Outcome<Page<Profile>>> {
  const result = await outcome(list({ query: after === undefined ? {} : { after } }), 200);
  return result.ok
    ? { ok: true, data: { posts: result.data.people, next: result.data.next } }
    : result;
}

/** What is shown: nothing while the account has opted out, nothing for a failed read, and nobody already asked. */
export function shownSuggestions(
  included: boolean,
  items: readonly Profile[] | null,
  asked: ReadonlySet<string>,
): Profile[] {
  if (!included || items === null) return [];
  return items.filter((person) => !asked.has(person.accountId));
}
