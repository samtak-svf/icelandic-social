# 0119. Importing a person's own content from another platform

- Status: accepted; amended by 0120, 0126 and 0127; implemented for the export file, its removal and the web
  screens, and our own export (0126) on the web; not yet a listed destination (#461)
- Date: 2026-10-31
- Decided by: the overseer, on Guðröður Atli Jónsson's question of how people can bring their data here and how public content can sync; his to overturn
- Amended by: [0127](0127-what-a-real-export-holds-and-how-it-comes-in.md) (classes, a truthful preview, holding before opening, albums), [0126](0126-a-person-takes-their-own-content-out.md) (our own export, the "at least as good" counterpart), [0120](0120-feeding-the-import-from-public-profiles-and-pages.md) (collection from a person's own public profile, with proof it is theirs, and a page through the source platform's API)

## Decision

**One import core, two entries.** The core takes one source post at a time and is idempotent on
the source's post id, so a repeated file or a retried delivery creates nothing twice. Two things
feed it:

1. **Uploading another platform's export file**, first, because it needs nobody's permission. The
   file goes to EU storage (decision 0001), a job parses it, and the upload is deleted after the
   import.
2. **Being a listed destination in another platform's export tool**, later. The platform pushes
   over an HTTP API we expose, and a scheduled transfer there makes a sync recurring.

Decision 0120 adds two more feeds to the same core: a person's own public profile and a page they
administer.

**What comes in is the person's own posts and media, and they go to their wall** (decision 0115).
The default audience is the wall's own, and the person previews and selects before anything is
published. An import is never public by default.

**A recurring sync is public only when the person said so, on that connection.** A push channel
need not say what audience a post had at the source, so "public content" cannot be read from it.
The person chooses "public there, public here" per connection, and can revoke the connection.

**An imported post keeps its original date and carries an imported mark.** The feed (decision 0116)
does not surface it as new, and it fires no notification.

**Not imported:** messages, other people's content and comments on it, and friend lists as
friendships. A friendship stays mutual (decision 0114), so a list can at most suggest an invitation
the other person accepts.

**The standing rules apply to imported content.** Metadata such as location is stripped from media,
moderation applies as on any post (decisions 0044, 0063, 0115), no personal data reaches a log
(decision 0008), storage is in the EU (decision 0001), and nothing crosses into end-to-end encrypted
chat (decision 0060).

**A person can undo it.** One action removes everything an import brought in. Our own export is at
least as good as what we accept.

**Organisation pages come later,** through the source platform's API and its app review (decision
0120).

## Why

A new platform starts empty, and people do not move to an empty wall. An export file reaches
everyone today and depends on no one's approval. A listed destination makes syncing possible through the
platform itself, and it uses the same core, so the second entry costs an API rather than a second
importer.

Keeping the source's id as the key is what makes the file route and the push route safe to repeat
and safe to combine.

## What this rules out

- Asking for a person's password on another platform.
- Publishing imported content publicly because the source seemed public.
- Importing content a person did not write, or a private conversation.

## Open

- **The repair of escaped letters has now run on a real export** (2026-11-01): every Icelandic letter
  arrived and nothing broke. What that file showed about the rest of the import is in
  [0127](0127-what-a-real-export-holds-and-how-it-comes-in.md).
- **Whether a deletion at the source reaches us.** An incremental transfer probably does not say.
  Until that is measured, removal here is the person's own action.
- **Iceland only on the web and the API.** Decision 0085 covers the stores. A lock on the web and the
  API is a separate record, because an address check also stops Icelanders abroad and on a VPN.
- **Legal and rights questions** go to the review before the open beta.
