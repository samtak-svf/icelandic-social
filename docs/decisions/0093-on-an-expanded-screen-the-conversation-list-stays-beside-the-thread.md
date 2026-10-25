# 0093. On an expanded screen the conversation list stays beside the open conversation

- Status: accepted; implemented (web)
- Date: 2026-10-25
- Decided by: Guðröður Atli Jónsson
- Amends: [0087](0087-wide-screens-get-their-own-layout.md) (Samtöl gets an expanded layout)

## Decision

0087 gave the community pages, the hub, `Stjórna` and Stofna samfélag their own layout on an
expanded screen, and left Samtöl as the phone column. From this record, on an **expanded**
window:

- **The conversation list is a column on the left, about 22rem wide, and the open
  conversation fills the rest.** Opening a conversation keeps the list in place, with the open
  one marked. The list scrolls on its own and stays in view while the thread scrolls.
- **With nothing open, the pane beside the list asks for a conversation**
  (`conversations_pick`). The list's heading is the page's heading until a conversation is
  open, and then the conversation's title is.
- **The thread has no back link**, since the list is beside it.

On **compact and medium** nothing changes: the list is one page and a conversation another,
with a back link. The web's layout map (`web/src/ui/layout.ts`) carries the choice as
`conversations: "list" | "list-and-thread"`, and the tests read it from there.

The apps follow when their conversation screens are given the adaptive list-detail layout
0087 already prescribes for two panes (Android's list-detail scaffold, iOS's split view).

## Why

On 2026-10-25 Guðröður marked a production screenshot of Samtöl at 1440 px with "ofmikið bil"
(too much space): the list sat in a 640 px column in the middle of the window, with a hand's
width of empty space between it and the rail. That is the gap 0087 closed everywhere else.
A messenger on a wide screen keeps its list beside the conversation, so switching
conversations is one click and the width carries content.

## What it rules out

- Widening the single list column. A wide list of one-line rows is harder to read and still
  leaves the conversation a page away.
- A third pane (conversation details beside the thread) for now. `Um samtalið` stays its own
  screen.
