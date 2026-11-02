# 0127. What a real export holds, and how it comes in

- Status: accepted; implemented in part (sorting, the truthful preview, whole text and captions, held until opened, more than four images), the rest designed, not yet implemented (#461)
- Date: 2026-11-01
- Decided by: the overseer, on Guðröður Atli Jónsson's question of how best to bring in everything an export offers; his to overturn
- Amends: [0119](0119-importing-a-persons-own-content.md), [0120](0120-feeding-the-import-from-public-profiles-and-pages.md) (the export file only)

## Decision

**An import is sorted, shown truthfully, and held until the person opens it.** The first real export
(one person's posts, 17 years, 1.3 GB) showed that the file holds far more than posts, and also
things that must not come in. Every count below is from that file, and it is one sample.

### Sorted into classes, by what the file proves

Each entry gets one class. The preview shows every class with its count, and the person can turn a
class on or off. A class is decided from the file's structure, never from an entry's title, because
titles are written in the person's own language.

| Class                                               | How the file proves it                                | Default     | Measured |
| --------------------------------------------------- | ----------------------------------------------------- | ----------- | -------- |
| The person's own words or own images                | What is left                                          | On          | 2791     |
| A bare link, with no words of their own             | Only a link in the entry                              | Off         | 944      |
| Written on someone else's timeline or page          | Its timestamp is in the file listing such posts       | Off         | see note |
| Hidden by the person at the source                  | The same text is in the archive file, within two days | Off         | 12       |
| A video and nothing else                            | Only a video in the entry                             | Cannot come | 115      |
| Someone else's image, with no words of the person's | The image is in none of the person's own media lists  | Not offered | 177      |
| Nothing                                             | No text, media or link                                | Skipped     | 2164     |

Note: 158 of the 224 entries in the other-pages file also sit in the posts file, and 90 of those were
counted under this class in the first measurement, which also looked at titles. The build counts it
structurally.

**Someone else's image never comes in.** 0119 rules this out, and today's parser breaks that rule:
it reads every image in an entry, so a reshare with no words would land on the person's wall as if it
were theirs. An image the person did not upload is dropped even when the entry has their own words,
and the words come in.

**The archive and the other-pages lists are read so that their posts stay out by default,** because
the person hid the first and addressed the second to someone. Nothing is brought in from those files
themselves.

### The preview promises what the publish delivers

The preview and the publish read one function, and a test holds their counts equal. Today the preview
counts 1234 images and 244 videos and does not say that 33 posts lose images, 7 texts are cut or 118
posts do not arrive. After this record it shows, per class, what arrives and what does not.

### Nothing the person wrote is cut

- **Text comes in whole.** The 5000-character limit is on what a person types into a composer. An
  imported post keeps its full text, up to the parser's 100,000 (the longest measured is 49,143). The
  clients already fold a long post.
- **A post keeps its images, up to 20.** The limit of 4 is the composer's, and the 33 posts above it
  came with more. A client shows the first four and how many more, and its viewer reaches them all.
  A post over 20 continues in a second post with the same date, which happened once.
- **A caption is text.** A caption differing from the post's text is added to it, and a caption on a
  post with no text becomes the text (69 posts). A post no longer loses words the person wrote
  because they were written on the image.

### Albums and photos outside the posts

About 70% of the media is not in the posts file at all. The import reads the album files too, as a
class of its own, on by default when the person chose albums in their export:

- A photo with a caption is its own post, under its own date.
- Photos without a caption from one album on one day form one post of up to 20 images, with the
  album's name as its text. In the measured file, 1296 photos in the person's own albums become about
  320 posts rather than 1296.
- A photo already in a post is not brought in twice: the media path is the key.
- **Profile pictures and cover photos** (146) are a class that starts off. They were never posts.
- **Uncategorized photos** (1638 outside posts) are a class that starts off, because what the file
  puts there is not yet measured and the person's own eye is the only test.

### Held until opened

**Everything comes in held: on the person's account, seen by nobody else, reviewed on the web import
screen as the real post it will be.** The person then opens it, all of it or by class or by year, to
friends or to everyone.

- **Why it must exist:** the export has no audience field in any of its files, so a post that was
  only-me or friends-only at the source looks like one that was public. Neither the file nor we can
  tell, and only the person can.
- **How:** a post state `held` in `post_index`. Every list reads `state = 'visible'` and a direct read
  refuses another state, so a held post fails closed everywhere, and only its author is let through.
  No client changes, and an older app has nothing new to decode. A new value of the wall audience was
  the alternative, and the core's strict enum would make an older client fail on the owner's own wall.
- **Opening** sets the state and the audience in one statement. The mark `backlog` still keeps the post
  out of the feed, no notification fires, and 0119's "one action removes everything" covers held posts.
- The upload is deleted once everything is held, as today after a publish, so a publish no longer spends
  the person's only chance to look. Our own export (0126) includes held posts, since they are the
  person's.

### Not carried, on purpose

Upload address and location in media metadata, tags of other people, places, events, earlier versions
of edited posts, the platform's own editor and sentiment data, memories and the links it generated.
They are parsed by nothing and stored nowhere.

### Video

Posts here hold no video, so video stays out, and the preview says how many (392 files, 1.1 GB). The
text of a post with a video comes in. Storing it is cheap, so cost is not the reason: video in a post
is a product of its own (players on three platforms, moderation, limits) and needs its own record.

### Order of the work

1. Classes and the truthful preview, with someone else's images out. Server and web only.
2. Whole text and captions.
3. The held state and opening.
4. More than four images, with the clients' "and N more". The apps need a release for this one.
5. Albums and photos.

## Why

The purpose of an import is that a person's wall here is recognisably theirs. A wall of 944 lone links
and 177 of other people's pictures is not, and a private post opened to friends cannot be taken back
from memory. Holding first means the person sees the result before anyone else does, and it turns a
one-shot publish into a step that can be judged.

## What this rules out

- Publishing an import directly to an audience.
- Reading an audience, or anything else, from an entry's title.
- A preview whose counts come from anything other than what the publish will do.
- Treating a reshare's image as the person's because it was in their file.

## Open

- **Whether a post that was only-me at the source is in the file at all.** It cannot be told from the
  file, and holding covers either answer.
- **What the uncategorized photos are.** The person's review of that class will say.
- **Export files in other languages and from other years** may differ. The first file is one sample,
  and the parser stays tolerant: an entry in a shape it does not know is skipped and counted.
