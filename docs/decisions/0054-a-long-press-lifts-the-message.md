# 0054. A long press lifts the message

- Status: accepted; implemented in the apps, released as 0.8.2; amended by 0072 (the actions are a bar at the foot)
- Date: 2026-10-15
- Decided by: the maintainer, choosing from the UX round on 0.7.3
- Amended by: [0072](0072-the-long-press-menu-is-a-bar-at-the-foot.md) (the actions are a bar at the foot)
- Builds on: [0022](0022-the-conversation-surfaces.md) (long press opens the message menu),
  [0045](0045-times-between-messages-and-one-reaction-pill.md) (the reaction row),
  [0046](0046-copy-a-message-and-open-its-links.md) (Afrita)

## Decision

- **A long press dims the rest of the screen and shows the pressed message above it**, at its
  place when it fits, with the reactions above the message and the actions below. Nothing else
  on the screen can be pressed until the menu closes; a tap outside closes it.
- **Each action has an icon before its words**: Svara, Afrita, Áframsenda, Breyta, Taka til
  baka. The words stay: an icon alone is guessed at.
- **"Taka til baka" is drawn in the danger colour**, last, and still asks before it deletes
  for everyone.
- The actions and their order are unchanged, and so are the screen-reader actions on the bubble
  (0022). With reduced motion the menu appears without the lift animation.
- **On iOS the system's context menu is kept**: it already lifts the message, dims the screen and
  holds every touch, and its actions carry their symbols. It cannot be recoloured, so "Taka til
  baka" is its destructive red; it brings reduced motion and VoiceOver of its own.

## Why

In 0.7.3 the menu is a plain list that covers the next message, so it is not clear which
message it acts on, and deleting for everyone looks like any other action. The established
messengers lift the message and mark the destructive action.

## What it rules out

- Swipe to reply and other hidden gestures (0022).
- Icons without words.
