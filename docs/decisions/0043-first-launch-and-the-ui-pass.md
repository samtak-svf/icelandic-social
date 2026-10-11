# 0043. A first launch that asks before it prompts, and a UI pass within 0022

- Status: accepted; implemented in the apps (#190, #191, #192, #193, #194, #197, #198)
- Date: 2026-10-10
- Decided by: the maintainer, approving the plan for the UI pass after the 0.3.0 hand test
- Builds on: [0009](0009-v1-scope.md) (the v1 surfaces), [0022](0022-the-conversation-surfaces.md)
  (what each screen shows), [0034](0034-fljotid-and-the-wall.md) (the feed's one line),
  [0035](0035-google-only-sign-in-and-merge-on-kenni.md) (where a name comes from),
  [0039](0039-profile-photo.md) (the photo), [0042](0042-mute-a-conversation.md) (mute)

## Decision

Until open beta the work is the experience of the apps. 0.3.0 showed testers a cold
permission prompt on first launch, a list that hides what is happening in it, and pickers
that make the common case (one person) take two taps. This record fixes what the screens do;
it adds no server or core state.

### First launch

- **Two steps, once per install, after sign-in and before the tabs: a photo, then
  notifications.** The Kenni verify offer (0035) follows them as today.
- **The photo step is optional** and uses the picker and upload of 0039. It shows the name
  sign-in delivered, which it does not let anyone edit: a name comes from Google or from
  verification (0035), never from a field.
- **The system notification prompt only follows a tap on "Kveikja á tilkynningum"** on the
  priming step. "Ekki núna" skips it; the notifications-off notice on the list stays the way
  back. Android 12 and earlier, which need no runtime permission, skip the step.
- **The empty list offers "Finna fólk" next to "Bjóða"**, leading to "Nýtt hjal", since
  everyone signed in is in the picker (0036).

### The conversation list

- **Long press on a row opens the mute menu of 0042** ("Þagga" with its three durations, or
  "Kveikja á tilkynningum"), the same choices as the conversation's own menu. There is no
  swipe on a row: 0022 keeps gestures to long press, and a hidden swipe is found by accident.
- **A row whose conversation has someone typing says so in place of its preview**, from the
  core's `Event::Typing`. A group row names no one, as the conversation does (0022).
- **The preview of an own last message carries its state**: a clock while pending, the
  failed mark, and the read state of 0022 ("Lesin" in a 1:1, the count in a group).

### The conversation

- **The composer shows one action at a time**: attach while the field is empty, send once
  there is text. While editing, send stays.
- **A pending message shows a clock**, whose screen-reader text is `message_sending`.
- **Tapping the title opens the conversation's information** (members, mute, timer), the
  sheet its menu already opens.
- **A shared post is labelled "Úr Fljótinu"** above its author, so it is not read as a
  message the sender wrote.

### Fljótið, Ég and the pickers

- **The feed's notice is one short line with an information button** that opens the full
  sentence. It is never hidden: 0034 requires the screen to say the feed is public and not
  end-to-end encrypted.
- **A refresh that brings newer posts while the reader is scrolled down shows a "Nýjar
  færslur" pill**; tapping it scrolls to the top.
- **On Ég, tapping the photo opens the photo picker**, beside the explicit buttons of 0039.
- **In "Nýtt hjal" a tap on a person opens a 1:1 at once.** A "Nýr hópur" row at the top
  switches to choosing several. The list stays above the keyboard.
- **The forward and share picker can be searched** by conversation name
  (`search_conversations`, 0038) and shows what is being sent.

### Everywhere

- **Every empty screen uses one component per app**: an icon, one line and at most one
  button.
- **Rows animate when the core's events change them**, long press and send give a haptic,
  and a first load shows placeholder rows instead of a blank screen. All of it follows the
  reduce-motion setting (0022).
- **Every visual state named here has a screenshot test on Android** (Roborazzi) and a
  model test on iOS, each failing before its change.

## Why

A permission asked for before the person knows what it is for is refused, and on iOS a
refusal cannot be asked again. The list is where people spend their time; what is happening in
a conversation should be visible there without opening it. The rest removes taps from the
common case. None of it needs data the core does not already return, so it ships without a
core or server release.

## Rules out

- Asking for a name on first launch, or editing one.
- The system notification prompt before the priming step.
- Swipe actions on list rows or bubbles.
- Hiding the feed's public notice.
- A dark theme in this pass; it needs dark tokens and contrast pairs per brand and its own
  record.
