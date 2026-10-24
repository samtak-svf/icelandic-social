# 0065. A community's content is in a `Space` object, and its images in the profiles bucket

- Status: accepted; implemented (#28); amended by 0082
- Date: 2026-10-18
- Decided by: Guðröður Atli Jónsson (phase 4, #306)
- Builds on: [0060](0060-a-social-platform-with-an-encrypted-messenger.md) (content in a
  Durable Object per space), [0063](0063-communities-audiences-and-moderation.md) (communities,
  what deleting removes), [0039](0039-profile-photo.md) (the re-encoded photo)
- Amends: [0004](0004-frozen-identifiers-vs-brand.md) (`cloudflare.durableObjects.space` is a
  frozen id)
- Amended by: [0082](0082-a-comment-carries-one-image.md) (a stored image belongs to a post or
  to one of its comments)

## Decision

- **The Durable Object class of a space is `Space`**, bound as `SPACE`, one object per
  community named by its community id and pinned to the EU per object id
  (`env.SPACE.jurisdiction("eu").getByName(communityId)`, only in `backend/src/env/`). The class
  name is frozen in `identifiers/ids.json` as `cloudflare.durableObjects.space`: a namespace
  belongs to its class, and renaming the class means a migration that moves every object.
- **The object holds a space's posts, comments and reactions.** D1 holds what crosses spaces:
  `post_index` (the feed and the access checks read it), `social_media` (each image, its
  uploader and its post) and `space_authors` (each space an account wrote in, so deleting the
  account reaches every object that holds something of it).
- **The images of posts are kept in `spjall-profiles` under `social/<community>/<image>`**, not
  in `spjall-media`. The media bucket's lifecycle rule deletes every object after 31 days
  (decision 0023), with an empty prefix, so a post's image would vanish under it; the profiles
  bucket has no rule, is in the EU and holds hosted, not encrypted, images already (0039).
- **An image is validated and re-encoded by the server.** The upload is at most 10 MB with a
  Content-Length; Cloudflare Images must read it as JPEG, PNG, WebP, GIF or AVIF (no SVG, no
  other file); what is stored is a WebP no larger than 2048 pixels a side, without metadata.
  An image no post takes within a day is deleted by the daily cron, and a post's images go with
  the post, its author's account or its community.

## Why

- 0060 named the binding `env.SPACE` and left the class name to the first space; a frozen id
  needs its own record (`tooling/ids-freeze.mjs`).
- A second bucket would be a new resource in the EU jurisdiction, created by the maintainer, for
  objects that have the same nature as the photos already in `spjall-profiles`.

## What it rules out

- Social images in `spjall-media`, or in any bucket with a blanket expiry.
- An image stored as uploaded: every stored image is one the server encoded.
- A Durable Object class per kind of space: a follower space (0060) is a `Space` object too,
  named by its own id.
