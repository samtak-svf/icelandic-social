# 0003. The directory lists only people who opt in, and organisations

- Status: accepted; deferred beyond v1 (0009)
- Date: 2026-10-05
- Decided by: Guðröður

## Decision

The directory ("finna fólk og fyrirtæki") contains:

- **people who have signed in and chosen to be listed**, showing what they chose to show;
- **businesses and institutions**, from a public company source decided in phase 3.

It never contains a person who is not a user, and never data from Þjóðskrá about anyone
beyond the signed-in user's own Kenni identity.

## Why

Listing every Icelander from the national registry would make the app a lookup service for
people who never agreed to it. Being findable is a choice the user makes, can see, and can
undo; a company's registry entry is public by law.

## Rules out

Importing the national registry; "people you may know" built from anyone's contacts on the
server; showing a kennitala in the directory.
