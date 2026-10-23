# 0082. A comment carries at most one image, through the post image pipeline

- Status: accepted; designed, not yet implemented
- Date: 2026-10-23
- Decided by: Guðröður Atli Jónsson
- Amends: [0009](0009-v1-scope.md) (comment images join v1),
  [0065](0065-the-space-object-and-social-media.md) (a stored image belongs to a post or to
  one of its comments), [0080](0080-communities-follow-the-familiar-group-layout.md) (the
  comment composer's photo button)
- Closes: #119

## Decision

0080 gave the comment composer a photo button, and #117 shipped the composer without one,
because nothing in the stack could hold an image on a comment. This record decides what the
button does.

### The model

- **A comment carries at most one image.** A comment is a text, an image, or both; a comment
  with neither is refused as it is today. Replies (0071) are comments, so a reply takes an
  image too.
- **The image is the same kind of object as a post image** (0065): validated and re-encoded
  by the server to a WebP of at most 2048 pixels a side, without metadata, at most
  `MAX_SOCIAL_UPLOAD` before re-encoding. No new format, size or encoder.

### Storage

- **The upload is the existing one:** `POST /v1/communities/{communityId}/media` returns a
  media id, exactly as for a post. Nothing in the upload says whether a post or a comment
  will take it.
- **The comment takes it by id:** the create-comment body gains `media`, an array of at most
  one media id, default empty. As for posts, the id must be the caller's own unattached
  upload to the post's community, or the comment is refused with `invalid_media`.
- **The row records both owners.** `social_media` gains a nullable `comment_id` in an
  additive migration (0068). A comment's image has `post_id` set to the comment's post and
  `comment_id` set to the comment. Because `post_id` is set, every path that already deletes a
  post's images by post id (the author deleting the post, the purge of removed posts,
  `forgetAccount`'s own posts, a community's `dropSpace`) deletes its comments' images with no
  new code. The 24-hour sweep of unattached uploads stays as it is: an upload no post and no
  comment took has `post_id` null.
- **The R2 key is unchanged:** `social/<community>/<media>` in `spjall-profiles`, so the
  key says nothing about what took it.
- **The image is served by the existing route,** `GET /v1/posts/{postId}/media/{mediaId}`,
  behind the same post access check. For a comment's image it also requires that the
  comment is visible to the caller: a hidden or removed comment's image is not served.
- **The `Comment` in the contract gains `media`,** the same `Media` objects (`mediaId`,
  `width`, `height`) a post carries, an empty array when it has none.

### Purge

| What happens                      | The image                                                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The author deletes the comment    | Its row and R2 object are deleted with it, in the same request                                                                                                             |
| The author deletes the post       | Deleted with the post's images (by `post_id`), as today                                                                                                                    |
| A moderator hides the comment     | Kept, not served while hidden; served again when it is shown again                                                                                                         |
| A moderator removes the comment   | Not served from then on; deleted by the daily purge once the removed comment is `REMOVED_KEPT_MS` old, the same window in which the comment's text is deleted by the space |
| The post is removed and purged    | Deleted with the post's images, as today                                                                                                                                   |
| The community is deleted          | Deleted with the community's media, as today                                                                                                                               |
| The author's account is forgotten | Every comment image the account uploaded is deleted, in posts of other people too, before the account's rows go                                                            |
| A space is restored (0068)        | D1 stays the truth: a restored comment whose image row is gone shows without its image, and no image comes back that a person or a moderator deleted                       |

### Moderation

- **Reporting a comment reports its image with it.** There is no separate report for an
  image, and the report carries the media id so the moderator sees the image.
- **Removing a comment removes its image.** Community moderators and platform moderators do
  this the way they remove a comment today; nothing new to learn.

### Contract

The change is additive: `media` is optional on the create body and new on `Comment`. It does
not carry `api: breaking`. An app from before this record shows a comment's text and not its
image, and an image-only comment shows as an empty bubble until the app is updated; the
release that ships the button also ships the rendering, and the minimum client version is
not raised for it.

### The clients

- The photo button picks one image from the system picker (no camera inside the app), shows
  it as a small preview above the field with a remove action, uploads it when the comment is
  sent, and sends the comment with its media id.
- A comment's image shows under its text inside the bubble, scaled to the bubble's width;
  tapping it opens the same full-screen viewer a post's images use.

## Why

The post image pipeline already does the hard parts: it decodes untrusted bytes to pixels on
the server, strips metadata, caps the size, keeps unattached uploads from piling up, and is
deleted on every path a post is. Reusing it, with the comment's post recorded on the row,
means a comment image cannot outlive anything a post image cannot outlive, and no new purge
path has to be remembered except the two that are specific to comments (deleting one comment,
and a moderator removing one). One image per comment keeps the composer a single row and a
comment a reply, not a second post.

## What it rules out

- More than one image on a comment, video on a comment, and files of any other kind.
- A separate upload route, storage prefix or bucket for comment images.
- An image report separate from the comment it belongs to.
- Taking a photo inside the app for a comment; the system picker offers the camera where the
  platform does.
- Raising the minimum client version for this change.
