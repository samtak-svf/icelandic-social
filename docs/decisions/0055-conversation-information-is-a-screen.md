# 0055. A conversation's information is a screen

- Status: accepted; implemented in the core (#244, core 0.24.0) and the apps, released as 0.8.4
- Date: 2026-10-15
- Decided by: the maintainer, choosing from the UX round on 0.7.3
- Builds on: [0043](0043-first-launch-and-the-ui-pass.md) (tapping the title opens the
  information), [0042](0042-mute-a-conversation.md) (mute), [0039](0039-profile-photo.md)
  (the photo), [0022](0022-the-conversation-surfaces.md) (what each screen shows)

## Decision

- **"Um samtalið" opens a screen, not a sheet.** At its top: the other person's photo, large,
  their name and the verified mark (0033), or for a group its name and members.
- **Each setting shows its state on its row**, as the timer does today: "Þagga" with "Slökkt",
  or until when, and "Tímabundin skilaboð" with its time. "Loka á" stays last, in the danger
  colour.
- **Shared photos and files are listed under the settings**: photos as a grid, newest first,
  files as rows with name and size. A tap opens them as in the conversation. The list comes from
  the core's store on this device, the same rows the conversation shows; nothing is asked of
  the server, and an item gone under a timer is gone here too.
- The same screen opens from the title and from the menu.

## Why

In 0.7.3 the information is a short sheet: the mute row does not say whether the conversation
is muted, and the photos and files sent in it can only be found by scrolling. Established
messengers open a screen with the person, the settings and the shared media.

## What it rules out

- A server-side media index: media stays end-to-end encrypted and listed from this device's
  store only.
- Search of message text on this screen; it needs its own record.
