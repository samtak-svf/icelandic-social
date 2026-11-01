# 0125. A group shows who has read, as faces under the message

- Status: accepted; designed, not yet implemented
- Date: 2026-11-01
- Decided by: Guðröður Atli Jónsson
- Amends: [0022](0022-the-conversation-surfaces.md) (a group's thread shows who has read, not how many)

## Decision

**In a group's thread, each member's small round face sits under the newest message that member has
read**, right-aligned, whoever wrote that message. Four faces show, then `+N`. A face moves down the
thread as its owner reads. Pressing the row names everyone in it, so nobody hidden behind `+N` stays
hidden, and a screen reader hears the same names.

**The rule lives once, in the core.** `Item.read_here` lists the people whose mark lands on that item.
The apps and the web only draw it, so three platforms cannot disagree about where a face belongs. It is
worked out from the whole conversation, not from the page on screen, so loading older messages cannot
move a face.

**A mark lands on the newest message at or before it.** A deleted or disappeared message holds no face,
and a card between messages does not either.

**Who is left out:** this account; the person who wrote the message, whose name is already on it; anyone
who has left the conversation; an account this one has blocked ([0024](0024-block.md)). With read markers
off, no faces show, as 0022 and [0009](0009-v1-scope.md) require of the toggle.

**The count stays where a face cannot go.** The conversation list keeps "how many have read" in its row,
and `read_by` still counts accounts, not devices. That count includes someone who read a message and
then left, which stays true: they did read it.

**A 1:1 keeps the word.** One other person needs no face to say who. The web thread, which showed no read
state at all, now shows the same word and the same faces as the apps.

**The server learns nothing new.** The marks are the encrypted read receipts each device already holds;
drawing them sends nothing.

## Why

A count tells the writer that two people have read, and not which two; in a group that is usually the
question. An established messenger answers it with faces under the message, which take almost no room
and need no reading. A tester-facing screen showing only "2 have read" was the prompt.

## What this rules out

- A per-message list of readers under every message. A face appears once per person, at the newest
  message they read. Who read an older message follows from the order.
- Computing the position in each app.
- Telling the server who read what: it holds receipts only as ciphertext.
