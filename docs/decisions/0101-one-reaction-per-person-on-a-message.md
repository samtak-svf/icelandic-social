# 0101. A chat message takes one reaction per person

- Status: accepted; implemented (#291)
- Date: 2026-10-26
- Decided by: Guðröður Atli Jónsson
- Amends: [0045](0045-times-between-messages-and-one-reaction-pill.md) (the pill counted every emoji a person added)
- Builds on: [0099](0099-what-this-device-did-shows-at-once.md) (a device's own reaction shows at once), [0100](0100-a-post-reaction-is-any-one-emoji.md) (a post's reaction is one per account)

## Decision

Each person has **at most one reaction on a chat message**. Reacting with another emoji replaces the earlier one; reacting with the same one again removes it, as before. This is the rule a post already has (0100) and a comment's single like (0080) implies.

The envelope does not change. A reaction stays `Body::Reaction { target, emoji, remove }`, sealed end to end, so the server neither knows nor enforces the rule. The core does:

- **Folding replaces.** Folding an add removes the sender's other emoji on that message before it stores the new one. Envelopes fold in the server's `seq` order, so every device of every member ends on the same, latest emoji, even when two devices of one account react at once.
- **Sending tells older builds.** When this device adds an emoji while its account already has another on that message, folded or still queued, `send` queues a remove of the old emoji first. A build from before this decision folds additively, and with the remove it shows the same single reaction.
- **The device's own view replaces at once** (0099): the pending add takes the person out of every other emoji on that message.
- **Stored reactions are keyed by person.** A store migration rebuilds `reactions` with the key `(group_id, seq, account)` and keeps one emoji where a person had several. The order they were added in was never stored, so the kept one is the first in code point order. History moved to a new device keeps one per person in the same way.

The apps need no change: they already send a remove only when the tapped emoji is the reader's own, and an add otherwise.

## Why

Guðröður found it on 0.16.0: a message showed several emoji from one person. A reaction says how a person took a message, and one answer per person is what Icelandic users know from established messengers and what the pill's count implies. Stacked emoji also make the count overstate how many people reacted.

## What it rules out

- Several emoji from one person on one message.
- Enforcing the rule on the server: it cannot read a reaction, and must not.
