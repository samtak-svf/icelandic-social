# 0100. A post reaction is any one emoji, the same as the chat

- Status: accepted; implemented (#273)
- Date: 2026-10-26
- Decided by: Guðröður Atli Jónsson
- Amends: [0063](0063-communities-audiences-and-moderation.md) (a post's reaction was one of five fixed kinds)

## Decision

An account reacts to a post with **one emoji**, one per account and post, replaced by the next. Any single emoji is allowed: one extended grapheme cluster that is an emoji, ZWJ sequences, skin tones, keycaps and flags included. Anything else (text, two emoji, an emoji with other characters) is refused with 400. One rule, `isEmoji` in `backend/src/api/emoji.ts`, is the validator for every hosted surface that takes an emoji.

Comments stay without reactions beyond the single like of 0071 and 0080.

The apps show the chat's quick bar (👍 ❤️ 😂 😮 😢 🙏) and a "+" that opens the platform's existing chat emoji picker on a post too. No second picker is written; the web, which had none, gets one small reusable component.

### The contract change is additive

Installed 0.15.x apps keep working with no upgrade:

- **Write.** `PUT /v1/posts/{postId}/reaction` takes `{ "emoji": "…" }` or, from an old build, `{ "kind": "like|love|laugh|wow|sad" }`; exactly one of the two. The server stores an emoji in every case: like 👍, love ❤️, laugh 😂, wow 😮, sad 😢.
- **Read, new.** A post carries `emojis: [{ emoji, count }]`, most used first, equal counts in code point order, and `myEmoji: string | null`.
- **Read, old.** `reactions: [{ kind, count }]` and `myReaction` stay exactly as they were, computed from the stored emoji: an emoji that maps to an old kind counts there, any other emoji is absent. They are deprecated in the OpenAPI document and **go once the client floor passes 0.16.0**, together with the `kind` request field.
- **Notifications.** A reaction notification carries `emoji` (null on other kinds and on notifications made before): the emoji the account first reacted with, since a notification is one per account and post.

### Stored data

The space Durable Object's `reactions` table renames its column `kind` to `emoji` and maps the five kinds to their emoji in one step on open (`ensureEmojiReactions`), so no reaction is lost and a repeat does nothing. The D1 `notifications` table gains a nullable `emoji` column (migration 0033, additive).

## Why

A chat message takes any emoji; a post offered five and no "+", so reacting to a post felt broken beside it and a reader could not answer with the emoji they meant.

## What it rules out

- A fixed set of reaction kinds on a post, or a second emoji picker.
- Breaking the installed builds: the old fields and the `kind` body stay until the floor passes 0.16.0.
- Reactions on comments beyond the like.
