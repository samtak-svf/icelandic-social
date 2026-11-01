# 0126. A person takes their own content out in one file

- Status: accepted; implemented on the web (#461); the file's layout is described in [export-format.md](../export-format.md)
- Date: 2026-11-01
- Decided by: the overseer, on Guðröður Atli Jónsson's order to finish #461's step 4; his to overturn
- Builds on: [0001](0001-eu-storage-and-residency-wording.md) (EU storage), [0008](0008-no-pii-in-logs.md) (no PII in
  logs), [0060](0060-a-social-platform-with-an-encrypted-messenger.md) (two kinds of content),
  [0067](0067-jobs-and-notifications.md) (jobs), [0091](0091-anonymous-posts-in-a-community.md) (anonymous posts),
  [0119](0119-importing-a-persons-own-content.md) ("our own export is at least as good as what we accept")

## Decision

**One ZIP of documented JSON and images.** A person asks for it on the web. A job builds it, and the
person downloads it from the same screen. `docs/export-format.md` describes every file and field.

**What it holds is what the person put here:**

- their profile and photo, and their list of friends;
- their posts, on their wall and in communities, with text, original date, audience, images,
  poll, and whether the post was imported or anonymous;
- their comments and replies, with their images;
- their reactions and poll votes, naming the post or comment they were on.

**Their own anonymous posts are included,** marked as such, because the file goes only to their author.
The file then names the author, so the screen says so before the person asks for it.

**A post or comment a moderator removed or hid keeps its text and state, not its images.** The person
wrote the words and may have them. An image taken down for what it shows is not handed back out by
the service that took it down.

**Not in the file:**

- Messages and chat media. The server holds only ciphertext, and only the devices can read them
  (decision 0060).
- Other people's content, including comments others wrote on the person's posts. A reference names
  a post by id, not by what it says.
- Kennitala and phone number. A file like this gets forwarded and backed up, and neither is content the
  person wrote. The account screen shows them.

**"At least as good as what we accept" is a test, not a claim.** Every field our importer takes from
another platform's file (`ParsedItem`: text, date, images, id) has a named counterpart in our format (a link is part of the text, and we hold no video, which the mapping says by name), and
a type and a test fail when the importer learns a field the export lacks. We do not write another
platform's format, and our importer does not read ours yet: nobody has asked, and a format of our own
is free to say what theirs cannot.

**Who.** An account may export whether or not it is suspended, because the content is its own.

**How often and how long.** One export per account in 24 hours, unless the last one failed. The file is
kept 7 days, a download after that answers `expired`, and the daily cron deletes the bytes. That sweep is
ours rather than an R2 lifecycle rule, which would be a dashboard step and could not touch the row.
Deleting the account deletes its exports and their bytes.

**How it is built.** A job (decision 0067), no Queue (decision 0001). Each run does a bounded amount of
work, saves a checkpoint and writes the next run's job, so a retried run repeats only what was not saved
and an account of any size stays within one run's subrequests.

- The file is a stored ZIP, written to `spjall-media` in the EU by R2 multipart in equal parts. Images are
  already compressed WebP, so deflating gains nothing, and no dependency is added.
- A run's state is **one R2 object**: its JSON and the unsent tail bytes in one put, so the two cannot
  disagree. A part is uploaded before the checkpoint that counts it. A run that dies between them
  uploads that part number again, which replaces it.
- Long content is split into numbered files per space, as the exports we accept split a long history, so a
  run never holds more than one page in memory.
- A file past ZIP32's limits fails with the code `too_big`, since our reader refuses zip64 (decision 0119's
  reader). It is measured when it happens, not designed for today.

**Logs carry ids, counts and codes only** (decision 0008).

## Why

A platform that takes people's content in and will not let it out is asking them to trust it more than it
has earned. The promise in 0119 had no format, contents, or limits. The closed beta is the cheap time to
fix them.

Everything else here follows from one split in 0060: hosted content the server can read and hand back,
and conversations it cannot. Saying plainly that messages are not in the file is what keeps both claims
exact.

Building in a job with a checkpoint, rather than one long request, is what lets a person with years of
images get a file at all. The import side already works this way, and a retried run costs nothing.

## What it rules out

- A file with messages in it, or a server that could produce one.
- Another person's words in the file.
- A download open to anyone with the link: the file is served only to its owner's session.
- Keeping an export past 7 days, or copying it outside the EU.
- A new stateful resource or a Cloudflare Queue for this.

## Open

- **Apps.** The entry is on the web only, as imports are. A deep link or a screen in the apps is a later choice.
- **Legal review.** Whether this file also serves as the answer to a data-access request, which would then
  have to include what is left out here, goes to the review before the open beta (0119).
