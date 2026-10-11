# 0046. A message can be copied, and its web links open on a tap

- Status: accepted; designed, not yet implemented
- Date: 2026-10-11
- Decided by: the maintainer, reporting after 0.6.0 that text cannot be copied and links do
  not open
- Builds on: [0022](0022-the-conversation-surfaces.md) (the long-press menu and its
  screen-reader actions), [0045](0045-times-between-messages-and-one-reaction-pill.md) (a tap
  on a bubble shows its time)
- Amends: 0009 (message actions: copy)

## Decision

### Copy

- **"Afrita" is in a text message's long-press menu** and among its screen-reader actions,
  after "Svara". It copies the whole text, without the quote it replies to. A text under a
  disappearing timer can be copied too: the reader can already read it, and the timer
  promises deletion from the devices, not secrecy from the reader (0022).
- **The copy is marked sensitive and stays on the device.** On Android the clip carries
  `ClipDescription.EXTRA_IS_SENSITIVE`, so the system's clipboard preview hides it; on iOS it
  is written `localOnly`, so Universal Clipboard does not send it to the reader's other
  devices.
- **"Afritað" confirms it** where the system shows nothing: Android before 13 and iOS.
- There is no selection of part of a message. Long press opens the menu (0022), and a copy
  pasted into the composer can be cut down there.

### Links

- **Web links in a text message are underlined and open on a tap**, in the default browser.
  A web link is a run of non-space characters starting with `http://`, `https://` or
  `www.` (opened as `https://`). Trailing punctuation that ends the sentence, `.,;:!?` and a
  closing bracket or quote without its opening one, is not part of it.
- A tap anywhere else on the bubble still shows its time (0045), and long press still opens
  the menu, on a link too.
- The link keeps the bubble's text colour and is told apart by its underline, so the contrast
  pairs of `brand/contrast-pairs.json` still hold.
- The screen reader reads the bubble as one element (0022), so opening each link is an action
  on it: "Opna" and the link as written.

## Why

Copying a message and opening a link are what every messenger does, and testers of 0.6.0 met
both missing in their first conversation: a link sent between them was plain text, and there
was no way to take it out of the app.

## Rules out

- **Link previews.** Fetching a page's title or image, by the sender or the reader, tells the
  site who is talking about it and when, outside the end-to-end encryption (0002). A preview
  made by the server would mean the server reads the link.
- Opening a link inside the app (a WebView or an in-app browser tab). The default browser keeps
  the reader's own sign-ins and settings and is one less surface to keep safe.
- Linking phone numbers and email addresses. They can come later with their own record.
- Copying a photo or a file.
