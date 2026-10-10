# 0036. Everyone signed in is in the new-conversation picker, found by name

- Status: accepted; designed, not yet implemented
- Date: 2026-10-10
- Decided by: the maintainer, after finding on a phone that a new account could not be
  reached without posting in Fljótið first
- Builds on: [0024](0024-block.md), [0034](0034-fljotid-and-the-wall.md),
  [0035](0035-google-only-sign-in-and-merge-on-kenni.md)
- Amends: 0003 (the directory in v1: everyone signed in, no opt-in), 0009 (finding people;
  name search no longer ruled out), 0034 (the picker no longer stays as it is)

## Decision

Signing in a device is enough to be found. Nobody has to post in Fljótið first.

- **"Nýtt hjal" lists every other account that has a name and a device the server still
  serves**, verified accounts first, then by name. The list is paged; it never sends the
  whole user base at once.
- **A search box narrows it by name.** The match is a substring of the name, compared without
  case and with the Icelandic letters folded to the plain ones (ð as d, þ as th, æ as ae, ö as
  o, accents dropped), so a keyboard without them still finds a person. The server stores the
  folded name as a generated column (`name_key`) with an index; the search text is never
  logged (0008).
- **Blocks hold both ways** (0024): the list leaves out an account the reader blocked and an
  account that blocked the reader, since neither side could start a conversation.
- **The list shows only what Fljótið already shows**: the account id, the name and the
  verified mark (0034). Never a kennitala, an email address or a phone number, and nothing
  about when or how often someone signed in.
- **People met in conversations** stay in the picker as before; the directory comes after
  them. Picking from either opens a conversation the same way (`open_direct`, or a group from
  several picks).
- The API is `GET /v1/people` (`q`, `after`, `limit`), and the core's `directory`.

## Why

0034 made everyone's name public to every signed-in account and let anyone open a private
conversation with anyone in Fljótið. The only thing still missing was a way to reach a person
who had not posted, which made posting a precondition for being reachable. In a closed test
group of named people that is a hurdle with no privacy gained: the names are already visible.

0003's opt-in was written for a directory open to everyone in Iceland. v1 is a closed group
(0009), where being signed in is itself the choice to take part.

## Rules out

- Contact matching: the server still learns nothing about whom a user knows.
- Listing anyone who has not signed in, and anything from Þjóðskrá beyond a person's own name
  and mark (0003 still holds there).
- An opt-out from the list within v1. If the service opens beyond the closed group, 0003's
  opt-in comes back for discussion in a new record before that release.
