# 0053. A photo fills its bubble, and three small fixes

- Status: accepted; implemented in the apps, released as 0.8.1
- Date: 2026-10-15
- Decided by: the maintainer, choosing from the UX round on 0.7.3
- Builds on: [0022](0022-the-conversation-surfaces.md) (bubbles, rows at large text),
  [0047](0047-the-header-attachments-me-and-new-conversation.md) (Ég),
  [0048](0048-server-time-lines-attachment-preview-and-photo-location.md) (captions)

## Decision

- **A photo reaches the edges of its bubble.** The bubble's own padding goes around the caption
  only, and the photo's corners follow the bubble's. A photo without a caption is drawn as the
  photo alone, with the bubble's shape and no coloured frame. A file keeps its padded bubble.
- **The status line under a photo stays where it is**, under the bubble as for text.
- **Initials stay inside their circle at every text size.** Their size follows the circle, not
  the font scale; the name next to it still grows.
- **Ég has a title in its band**, as the list has, and the screen scrolls under it.
- **An empty "Lokað á" is one muted line**, not a card with an icon: there is nothing to act on.

## Why

In 0.7.3 a photo sits inside a thick frame of the bubble colour, which reads as a border round
a picture rather than a picture sent; established messengers draw it to the edge. At 170 % text
the initials spill out of their circle, Ég starts at the status bar with no title, and an empty
list of blocked people takes as much room as the settings above it.

## What it rules out

- Cropping a photo to a fixed shape: it keeps its aspect ratio within the size limits it has.
- Scaling initials with the font: the circle does not grow, so they would not fit.
