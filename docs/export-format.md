# The export file

What a person gets from the export screen (decision [0126](decisions/0126-a-person-takes-their-own-content-out.md)):
one ZIP of their own content, built by a job and kept for seven days. Every file is UTF-8 JSON except the
images. Keys are English and stable; a change to a key, or a file added or removed, raises `format_version`.
A reader checks `format_version` in `export.json` first and refuses a number it does not know.

Dates are ISO 8601 in UTC (`created_at`), with the same instant in epoch milliseconds beside it (`created_at_ms`).
Ids are the ids this service uses; they are stable across exports.

## Layout

```
export.json                              last entry written; the manifest
profile.json
profile/photo.webp                       only when the person has a profile photo
friends.json
spaces/<space-id>/space.json
spaces/<space-id>/posts-0001.json        pages of posts, numbered, oldest first
spaces/<space-id>/comments-0001.json
spaces/<space-id>/reactions-0001.json
spaces/<space-id>/images/<media-id>.webp
```

A page file holds an array. The number of records per page is not part of the format: a reader concatenates
the pages of one kind in file-name order.

## export.json

| Field                         | Meaning                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `format_version`              | `1` today.                                                                          |
| `export_id`, `account_id`     | The export and the account it belongs to.                                           |
| `created_at`, `created_at_ms` | When the person asked.                                                              |
| `counts`                      | `posts`, `comments`, `reactions`, `images`, `spaces`, `friends`, `images_withheld`. |
| `left_out`                    | Sentences naming what the file does not hold (below).                               |

## profile.json

`display_name`, `bio` (both may be `null`), `created_at`, `created_at_ms` (when the account was made),
`has_photo` (then `profile/photo.webp` exists).

## friends.json

An array of `{ name, since, since_ms }`: the name of each friend and the day the friendship began. Only the name;
no contact detail of another person is in the file.

## space.json

`{ id, kind, name }`. `kind` is `wall` (a person's own wall), `community`, or `unavailable`. `unavailable` is a
space the person wrote in that no longer resolves to a name or kind, for example a community that was deleted:
its records are still exported, with `name: null`. The spaces come from where the person wrote (a post, a
comment, a reaction, a poll vote, a comment like), so a space the person only read is not in the file.

## posts-NNNN.json

Only the person's own posts, including those imported from another platform.

| Field                         | Meaning                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`                          | The post id.                                                                                          |
| `created_at`, `created_at_ms` | When it was published.                                                                                |
| `body`                        | The text, as written.                                                                                 |
| `audience`                    | Who could see it on a wall, or `null` in a community.                                                 |
| `state`                       | `visible`, `hidden` or `removed`. A hidden or removed post keeps its text here.                       |
| `anonymous`                   | The post was anonymous to the community. It is named to its author here.                              |
| `imported`                    | The post came in through an import.                                                                   |
| `images`                      | Paths of the post's images in the file.                                                               |
| `images_withheld`             | Present and `true` when an image is not in the file (below).                                          |
| `poll`                        | `{ options: [{ id, text }], my_vote }` when the post has a poll; `my_vote` is an option id or `null`. |

## comments-NNNN.json

Only the person's own comments: `id`, `post_id`, `parent_comment_id` (or `null`), `created_at`,
`created_at_ms`, `body`, `state`, `images`, and `images_withheld` as for a post. A comment others wrote on the
person's posts is not here.

## reactions-NNNN.json

Records with a `type`:

- `post_reaction`: `post_id`, `emoji`, `created_at`, `created_at_ms`.
- `comment_like`: `comment_id`, `created_at`, `created_at_ms`.
- `poll_vote`: `post_id`, `option_id`.

## Images

`spaces/<space-id>/images/<media-id>.webp`, the stored image as it is, named by the id the post record lists.
An image is **withheld** (and the record says `images_withheld: true`) when a moderator took it down, when its
post is hidden or removed, when its comment is not visible, or when its bytes are gone from storage. The text of
such a post or comment is still exported.

## What the file leaves out

The same sentences as `left_out`: messages and chat media (only the devices can read them), other people's
content including comments others wrote on the person's posts, kennitala and phone number, and the images
described above.

## Limits

A file holds at most 65 534 entries and ends below 4 GiB; a person with more gets the failure `too_big`
(the format has no ZIP64 part, deliberately: the importer reads the same subset).

A build that fails on its job's last try ends with the failure `build`, and one stuck for a day with `stalled`; the person may ask again at once after either.
