import type { Standing } from "./communities.ts";

// What an account may do in a community (decision 0063), from its standing.
// Every route that reads or writes something of a community asks these, so
// the rules are in one place.

/** Reads its posts and members: anyone signed in for an open one, members for a private one. */
export function canRead(s: Standing): boolean {
  return !s.banned && (s.audience === "open" || s.role !== null);
}

/** Approves requests, invites and handles content: the moderators and the owner. */
export function moderates(s: Standing): boolean {
  return s.role === "owner" || s.role === "moderator";
}
