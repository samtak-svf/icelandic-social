# 0109. The notifications are a bell in the top bar, not a tab

- Status: accepted; implemented (#325); amended by 0111, 0124
- Date: 2026-10-27
- Decided by: Guðröður Atli Jónsson
- Amends: [0080](0080-communities-follow-the-familiar-group-layout.md) ("Navigation on the web":
  the tab bar no longer carries the notifications or their count),
  [0087](0087-wide-screens-get-their-own-layout.md) (the rail has the same places as the tab
  bar, now without the notifications, and no badge)

## Decision

- **The notifications leave the tab bar**, and on the web from medium up the left rail. The
  bar and the rail keep the other places, in the same order.
- **They become a bell at the right end of the top bar** on Android, iOS and the web, at every
  window size class. The unseen count is drawn on the bell as a badge (up to 99, then `99+`)
  and read out with it: the bell is named by `notifications_title` and its value is
  `notifications_unread`.
- **Tapping the bell opens the existing notifications screen.** While it shows, the bell is
  marked as the current one (filled, in the primary colour; `aria-current` on the web).
- The bell sits in each place's own header, after that screen's actions. A screen pushed from
  a place (a post, a conversation, a link) draws none: its top bar is a way back.
- On the web the top bar is drawn at every width; from medium up it carries only the bell,
  since the name already heads the rail.

## Why

A tab is a place a reader goes to and stays in. The notifications are a list read in passing,
then left for what they point at. An established messenger with a social side, and most
community apps, keep them as a bell at the top, so a reader who looks for the count looks
there. Taking them out of the bar also gives the remaining places more room at 360 px.

## What it rules out

- A notifications tab or rail entry next to the bell, or a second unseen count elsewhere.
- A bell on screens pushed from a place; the count is one tap back.
