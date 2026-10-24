# 0089. A community has tabs: Umræða, Fest, Myndir, Meðlimir, Um

- Status: accepted; designed, not yet implemented
- Date: 2026-10-24
- Decided by: Guðröður Atli Jónsson
- Amends: [0080](0080-communities-follow-the-familiar-group-layout.md) (the community page
  under the header), [0079](0079-community-layout-feed-and-management.md) (the member list is
  a tab), [0009](0009-v1-scope.md) (community tabs are in v1)
- Builds on: [0087](0087-wide-screens-get-their-own-layout.md),
  [0088](0088-a-community-features-several-posts.md)

## Decision

Under the community header sits a row of tabs. Each tab is its own route, so it can be linked
to, shared and opened with the back button.

| Tab        | Shows                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `Umræða`   | The feed, as today. The default tab                                                                                 |
| `Fest`     | The featured posts of 0088 as full cards. Hidden while none is featured                                             |
| `Myndir`   | Every image in the community's posts and comments the reader may see, newest first, as a grid; a tap opens the post |
| `Meðlimir` | The member list: owner and moderators first, then the members by name                                               |
| `Um`       | `Um samfélagið`, as today                                                                                           |

- **The row is sticky** under the top bar while the page scrolls, and carries the community's
  search as an icon at its end; search no longer takes a full-width field above the feed.
- **On compact the row scrolls sideways**; nothing is folded into a `Meira` menu, so every tab
  stays one tap away. On expanded `Um` stays a tab although the aside repeats its summary.
- **Every tab reads through the community's read rule.** A non-member of a private community
  sees only the header and `Um`, as today. `Myndir` lists only images from posts and comments
  the reader may see: a removed post's images leave it, and a blocked account's images are
  hidden as its posts are (0063).
- `Myndir` is served by one paged endpoint reading the media references the posts already
  store; it adds no copy of an image and no new storage.

## Why

The desktop comparison of 2026-10-24 (kept privately under 0073) showed a group's tabs as the
way readers find a group's pictures, members and description without scrolling the feed. Here
the members and `Um` are a screen away behind the audience line and `⋯`, and the images in a
community cannot be browsed at all. Tabs are the shape readers already expect, they are routes
rather than state so a link to the members or the pictures works, and the tab set is limited to
what the community already holds, so no tab is a promise of a feature that does not exist.

## What it rules out

- Tabs for things a community does not have (events, files, open questions); each needs its
  own record first.
- A tab that a community's owner adds, removes or renames.
- A tab whose contents bypass the read rule, or a media tab that stores its own copies.
