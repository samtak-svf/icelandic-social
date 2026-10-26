# 0095. The conversation header has one way into the conversation's information

- Status: accepted; implemented in the apps
- Date: 2026-10-26
- Decided by: Guðröður Atli Jónsson, pointing out on 0.14.2 that the header's three controls
  overlap
- Amends: [0047](0047-the-header-attachments-me-and-new-conversation.md) (the header's menu
  button), [0055](0055-conversation-information-is-a-screen.md) (the screen opens from the title
  and from the menu)

## Decision

The open conversation's header on Android and iOS is the back button followed by the photo
and the title. **A tap on the photo or the title is the only way from the header into the
conversation's information.** It works for a 1:1 and for a group, in every state that 0047
gave a menu to.

- **The circled information button goes.** It opened the same screen the title opens.
- **The "more" menu (⋮ on Android, the circled ellipsis on iOS) goes.** Each of its items is
  already a row on the information screen, which shows the row's state:
  - Upplýsingar was the screen itself.
  - Disappearing messages, mute or unmute, and block in a 1:1 are rows on the information
    screen (0055).
- Mute stays one tap from the list too, in the row's long-press menu (0043). That menu is
  unchanged.
- The title keeps its button role and its click label `conversation_info`, so a screen reader
  announces where it leads.

The web header has no menu, and the web's group information page (0094, #225) opens from the
title in the same way.

## Why

On 0.14.2 the header of a group showed three controls side by side: the title, an information
button and a menu. The first two did the same thing. The menu's first item did that thing a
third time, and its other items each repeated a row of the screen they all opened. Three
controls that lead to one place make a reader ask what is different about each, and nothing
is. The common shape among established messengers is a title that opens the information, and
the header's other room is kept for actions of its own.

## What this rules out

- A second control in the header that opens the information.
- A header menu whose items are copies of rows on the information screen. A future header
  action that is not on that screen (a call, for example) gets its own button and a record.
