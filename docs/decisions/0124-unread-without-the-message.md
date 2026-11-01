# 0124. The web shows what is unread, without the message

- Status: accepted; implemented (this record's PR)
- Date: 2026-11-01
- Decided by: Guðröður Atli Jónsson
- Amends: [0064](0064-non-phone-devices-are-linked-devices.md) and
  [0081](0081-the-browser-runs-the-blocking-core-in-a-worker.md) (the chat runs under every signed-in page of a
  linked browser, not only under the conversations), [0087](0087-wide-screens-get-their-own-layout.md)
  and [0109](0109-notifications-bell-in-top-bar.md) (the place of the conversations carries a badge, and
  the bell's count adds the unread conversations)

## Decision

**A browser with a linked chat shows what is unread on every page**: a count on the place of the
conversations, the same count added to the bell, and a section on the notifications page listing who
wrote and how many. No message text appears in any of them. A muted conversation does not count in any
of the three, and keeps its grey count in the conversation list.

**All of it is read from this browser's own store.** The server learns nothing new and sends nothing
new: it cannot read these messages, so it could not count them. The chat's part of the bell clears only
by reading the conversation, not by opening the notifications page.

**Opening a conversation on the web marks it read**, as the apps do, once the timeline is read and only
while the tab can be seen. The mark goes out as a read receipt when the reader's setting allows it
([0022](0022-the-conversation-surfaces.md)). Without this the count could never fall.

**The chat runs under every signed-in page of a browser that has a chat linked.** A browser with none
starts nothing until the conversations are opened, so it loads no core for a person who never chats
there.

**A tab showing the conversations takes the store from one that only counts.** A second lock says which
tab shows them. Its holder takes the store at once from a tab elsewhere in the app; two tabs showing the
conversations still ask the person, as before. A tab that only counts never takes anything and never
shows the take-over.

**The other tabs get the count from the tab holding the store**, over a channel of this origin and in
memory only, because one tab at a time can open the store. What crosses it has no message in it, and
nothing is written at rest.

Both counts in a badge stop at `99+`.

## Why

A person with the web open saw nothing of an unread message until opening the conversations, and the
count on the conversation row never fell on the web, because nothing there marked a conversation read.
The end-to-end encryption rules out the server telling the page, and it does not rule out the page
asking its own store.

Reading the store on every page is the cost of that, and it is why a browser with no chat linked starts
nothing, and why the store moves to the tab that needs it instead of being held by the first tab opened.

## What this rules out

- A count from the server, or any new server state about unread messages.
- Message text on the notifications page, on a badge, or between tabs.
- Writing the count to browser storage to survive a reload; it is read again from the store.
- A count on the conversations place in the apps: this record is the web's. The apps keep their
  own notification path.
