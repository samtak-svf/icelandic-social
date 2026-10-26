# 0045. Times go between messages, and reactions are one pill on the bubble

- Status: accepted; time lines amended by [0048](0048-server-time-lines-attachment-preview-and-photo-location.md)
  (the server's time; no line for a late message), implemented in the apps (77774c9),
  released as 0.6.0; one reaction per person, amended by
  [0101](0101-one-reaction-per-person-on-a-message.md)
- Date: 2026-10-11
- Decided by: the maintainer, choosing items 1, 3 and 4 of the 0.5.0 UX review
- Amends: [0022](0022-the-conversation-surfaces.md) (grouping: "one time"; the reaction
  chips), [0043](0043-first-launch-and-the-ui-pass.md) (the meta line under a bubble)
- Builds on: [0022](0022-the-conversation-surfaces.md) (items are ordered by `seq`)

## Decision

### Times go between messages

- **A bubble has no time under it.** The timeline gets a centred time line instead, and a
  time line takes the day line's place. One goes before an item when any of these holds:
  - it is the first item;
  - its local day differs from the previous item's;
  - its time is an hour or more from the previous item's, before or after.
- **A time line names the day and the time:** "15:16" today, "Í gær 23:01", the weekday within
  the week ("mánudagur 09:12"), else the date ("30. ágúst 14:00"), and with the year when it is
  not this one. It uses the day line's style, so the words for today and yesterday stay brand
  strings.
- **A message that arrives late gets its own line** (withdrawn by 0048: a line shows the
  server's time). Items stay in `seq` order (0022), so a
  message sent offline yesterday and delivered today sits among today's. Its day differs from
  the previous item's, so a line saying "Í gær 23:01" goes before it, and the next item, back
  on today, gets a line too. No time is ever shown under the wrong day.
- **Tapping a bubble shows its exact time under it**, and tapping again hides it. Tapping a
  photo still opens it, and a file still opens its preview. The screen reader still reads the
  time as part of the bubble (0022).
- **The meta line under a bubble keeps only what is not a time:**
  - "breytt" for an edited message;
  - the clock while sending (0043), and the failed line;
  - who read it ("Lesin", or the count in a group) under the newest own message someone has
    read.
- Grouping is unchanged: messages from one sender less than 5 minutes apart form one run,
  with one name and tighter spacing.

### Reactions are one pill on the bubble

- **One pill per bubble** overlaps the bubble's bottom edge by half its height. It sits at the
  end facing the middle of the screen: the left edge of an own bubble, the right edge of
  another's. The bubble below it moves down by the overlap.
- **The pill shows up to three emoji**, the most used first, then the number of reactions when
  there is more than one. It takes the gold chip pair when one of them is the reader's, and
  `fg` on `muted` otherwise.
- **Tapping the pill opens a sheet titled "Viðbrögð".** It lists each person with their emoji,
  the reader first. Tapping the reader's own row removes their reaction. Reacting is still in
  the long-press menu and its screen-reader actions (0022).
- The pill is part of the bubble's screen-reader element: "{count} viðbrögð" (`one`:
  "{count} viðbragð"), and opening the sheet is a custom action.

## Why

The 0.5.0 review put the conversation next to two established messengers. A time under every run is
what made it look long and heavy. A test conversation spread over a day showed a time under
every bubble, because no two came within 5 minutes. One of them puts the time between messages,
only where there is a gap, and that is what Icelandic users know best. A time line also answers
the out-of-order case. 0022 orders by arrival, and #200 kept the day lines from going back.
Even so, a message from 23:01 yesterday showed under "Í dag", next to a shared post from 00:00.

One pill per bubble, sitting on it, is what both of them do. Chips on their own
line under the bubble added a row per reacted message. Listing who reacted needs the sheet,
because a pill no longer shows a count per emoji.

## Rules out

- Reordering the timeline by the sender's clock. Clocks differ, and `seq` is the id the read
  marks and the lazy list rely on (0022).
- Swipe to reveal times, as one established messenger does. 0043 rules out swipe actions on bubbles.
- A time under every bubble, or under every run, as a setting.
