# 0117. Names in the UI are one table

- Status: accepted; implemented
- Date: 2026-10-30
- Decided by: Guðröður Atli Jónsson (the two words); the table design is the overseer's
- Amends: [0079](0079-community-layout-feed-and-management.md), [0080](0080-communities-follow-the-familiar-group-layout.md) and [0116](0116-the-feed.md) (the labels they quote)
- Builds on: [0004](0004-frozen-identifiers-vs-brand.md) (frozen identifiers apart from the brand)

## Decision

### The two words

- **What the code calls a community is `hópur` in the UI**, plural `hópar` (BÍN `662d8f28aec3bdb5e6acdccc23c3b460`).
  The owner's reason, verbatim: "Samfélög er soldið stórt orð, hönnun á verkefninu á að gera það auðveld að breyta
  nöfnum".
- **An encrypted group conversation is `hópsamtal`.** `hópur` meant that conversation in about 22 strings, and one word
  means one thing, so those strings moved. `privacy_data_body` already said `hópsamtöl`. BÍN has no such headword, so its
  forms are the prefix `hóp` on the forms of `samtal` (BÍN `ef0c860639cf692a25bf576ffc276415`).
- **`samfélag` is retired** (BÍN `1c31ce6f8864510523ff7383285ec92b`): no string may carry a form of it.

### Identifiers stay

`community`, `communityId`, route paths, tables, string keys and the API do not change, and neither does the English
"group" that names a conversation in code. A UI word is not a contract: renaming one never needs a migration, an
`api: breaking` label or a client release beyond the strings it ships with. This is the separation of
[0004](0004-frozen-identifiers-vs-brand.md) applied inside a brand.

### The table

- **`brand/<name>/terms.is.json` holds a term's headword, its BÍN guid, its forms and its agreement words.** The
  agreement words are the ones a string needs and that lean on the noun's gender: the demonstrative, the pronoun, and the
  adjectives and participles such as open and closed. The slots are documented at the top of the file. It belongs to the
  brand, so a fork's brand carries its own table, or none.
- **A string writes a token, not the word:** `Stofna [[group.acc]]`, `[[Group.it.nom]] hverfur strax`. A capitalised id
  capitalises the first letter. Tokens sit beside `{name}` placeholders without touching the placeholder contract.
- **`brand-gen` expands tokens, so every generated file holds plain text** and no client or runtime knows the table
  exists. Generation refuses when a token reaches an output.
- **Forms come from BÍN and are never typed:** `node tooling/terms-forms.mjs <headword>` prints them, and exits 3 with
  nothing printed when BÍN did not answer. The repository holds its own fetcher because the tool that does this elsewhere
  lives outside it. Agreement words are checked against BÍN by hand when a term is set, since they are not forms of the
  noun.

### The gate

`tooling/brand-check.mjs`, in `pnpm check`, fails on: a raw form of a term's noun in a string, including inside a longer
word; an unknown token or slot; a malformed token; and any form of a retired word. A real word that merely contains a
noun is declared in `compounds`, with its reason (`prófunarhópinn`, the testers).

### What names a term elsewhere

Code comments and tests name a string key or say "the community". Tests read the generated string rather than repeat
it. A word a test types as user content, such as a post body or a conversation's name, is data and is not the term.

## What a rename now costs

Measured on a scratch copy with a throwaway feminine noun, which also moves every agreement word: **one edited file, the
table**, and three generated files (Android, iOS, web), with no other file touched and the gate green.

The cost that remains is what no table can remove:

- **Grammar is a review.** A new gender may read wrong in a sentence the table cannot see, so a rename reads every
  string that carries a token.
- **A screenshot that shows the word is re-recorded**, as a brand switch already is (`docs/testing.md`).
- **Records before this one keep the words they were written with.** They are history.

## What this rules out

- A runtime lookup of a term, in any client. Generated text is plain.
- `{group}` interpolation at runtime: the word inflects, and its neighbours inflect with it (0004).
- Renaming an identifier because a UI word changed.
- Typing a form by hand into the table.

The `póstur`/`færsla` mix in the strings is left as it is. It is the next term the table can take.
