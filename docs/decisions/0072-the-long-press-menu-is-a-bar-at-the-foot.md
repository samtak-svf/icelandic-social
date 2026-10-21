# 0072. The long-press menu is a bar at the foot of the screen

- Status: accepted; implemented on Android, released as 0.9.5
- Date: 2026-10-21
- Decided by: Guðröður Atli Jónsson, from a side-by-side comparison with an established messenger on a phone
- Amends: [0054](0054-a-long-press-lifts-the-message.md) (where the actions are drawn)

## Decision

- **The actions are a bar at the foot of the screen**, full width, above the navigation bar and
  above the scrim. Each action is its icon over its word. The pressed message is still lifted
  over the dimmed screen with the reactions above it (0054), now in the room above the bar.
- **The bar has at most four slots**, filled in this order: Svara, Afrita and Taka til baka
  first (each when it is offered), then the rest (Áframsenda, Breyta) while they fit. When more
  than four are offered the fourth slot is **Meira**, which opens a sheet with the rest as rows
  of icon and words. "Taka til baka" is never behind Meira.
  - Your own text message: Svara · Afrita · Taka til baka · Meira (Áframsenda, Breyta).
  - Someone else's text message: Svara · Afrita · Áframsenda, with no Meira.
- **The bar's icons and words are the foreground colour**, and "Taka til baka" keeps the danger
  colour. The brand colour is red and would hide the one action that must stand out.
- **The emoji row ends in "+"**, which opens the system emoji picker; any emoji can be given,
  as the core already accepts (`Body::Reaction { emoji }`).
- **An emoji the reader has already given is marked in the row** with the gold wash and a ring
  of the verification gold; tapping it takes the reaction back, as before. The reader's own
  reaction pill takes the same wash and ring in place of solid gold: a yellow emoji on solid gold could
  not be told apart from it.
- The screen-reader actions on the bubble keep the full list (0022). iOS keeps the system context
  menu (0054); the web has no long press.

## Why

The card of actions under the bubble covered the next messages and moved with the bubble, so
its place on screen changed with every press. The established messengers keep the actions in one bar at the foot
and the emoji above the message, and testers know that layout. Six fixed emoji left no way to
give any other one.

## What it rules out

- Icons without words (0054).
- The destructive action behind Meira.
- A centred dialog for Meira: it comes out of the bar, so it is a sheet like the reactions sheet.
