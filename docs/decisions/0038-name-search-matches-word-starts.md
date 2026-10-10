# 0038. The name search matches the start of a word

- Status: accepted; implemented in the backend (#156)
- Date: 2026-10-10
- Decided by: the maintainer, choosing it from a comparison with an established messenger
- Amends: [0036](0036-everyone-signed-in-is-in-the-picker.md) (the search matched any
  substring of the folded name)

## Decision

The search in the new-conversation picker matches the start of the folded name, or the start
of a word in it, a word being what follows a space or a hyphen. "gud" finds a name whose first
name starts with "Guð", one whose later name does, and the second part of a hyphenated name
such as "Bergs-Guðnadóttir", but not a name that only contains "gud" in the middle of a word.

Everything else in 0036 holds: the folding (case, ð as d, þ as th, æ as ae, ö as o, accents
dropped), `%` and `_` taken as themselves, the order, the paging and its cursor. The folded
`name_key` column is unchanged, so there is no migration.

## Why

A substring match returns names the person searching did not mean: a few letters typed to find
a first name also bring up every name that happens to contain them mid-word. People search for
a person by how a name begins, which is how established messengers behave, so the hits are
fewer and none of them surprising.

## Rules out

- Substring matching anywhere in a word.
- Fuzzy or typo-tolerant matching. A misspelt start finds nothing; a new record is needed
  before the search guesses.
