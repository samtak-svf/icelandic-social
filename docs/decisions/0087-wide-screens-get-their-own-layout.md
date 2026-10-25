# 0087. Wide screens get their own layout, keyed to the size classes of 0086

- Status: accepted; implemented (web #175, #176, #177, #182, #185; Android #195; iOS #196)
- Date: 2026-10-24
- Decided by: Guðröður Atli Jónsson
- Amends: [0080](0080-communities-follow-the-familiar-group-layout.md) (navigation on the web,
  the header's actions row, `Um samfélagið` and `Stjórna` on wide screens),
  [0086](0086-images-are-framed-per-screen-size.md) (the breakpoints join the frame
  specifications in the contract), [0009](0009-v1-scope.md) ("Look": the bottom tabs are the
  compact layout)

## Decision

Every screen of the web and the apps is today the phone layout. The web draws one 640 px
column at every width (`web/src/ui/shell.tsx`), and the apps stretch their phone screens across
a tablet or an unfolded phone. From this record a window's **size class** decides its layout,
on every client, from one definition.

### One definition of the size classes

- **The breakpoints of 0086 are the layout's breakpoints**: compact below 600, medium from 600
  to below 840, expanded from 840 (dp, pt or CSS px). They are the window's width, never the
  device's model.
- **They are defined once, beside the frame specifications** in the backend's zod schemas,
  published in `api/openapi.json` with them, and held equal in every client by the same guard
  that holds the frame sizes (`tooling/frames-check.mjs`). No client types 600 or 840 by hand;
  the web's Tailwind breakpoints are generated from the contract.
- Each client has one function from a width to a size class and one from a size class to a
  layout, and the layout function is what the tests exercise.

### Compact: unchanged

Below 600 nothing changes: bottom tabs in the apps, the icon tab bar of 0080 on the web, one
column.

### Medium: a rail and one column

- **Navigation moves to a left rail**, the same five places with the same badges. The bottom
  tabs and the web's top bar go.
- The content stays one column, centred, no wider than it is today, so text keeps a readable
  line length.

### Expanded: a rail, a feed column and an aside

- **The rail as at medium.**
- **The community page has two columns:** the feed (header, composer, posts) and, to its
  right, a sticky **aside** holding what `Um samfélagið` holds today (the description, the
  audience explained, the residency sentence of 0001), the member pictures, and the featured
  posts when [0088](0088-a-community-features-several-posts.md) is built. `Um samfélagið`
  stays reachable as its own screen at every width, so a link to it never breaks.
- **`Stjórna` becomes a side navigation inside the community**: `Breyta samfélagi`,
  `Beiðnir um aðild`, `Tilkynnt efni`, `Meðlimir` and `Aðgerðaskrá`, each its own page with the
  navigation kept in place, the counts on the items. On compact and medium it stays the one
  screen of 0079 and 0080.
- **The hub shows the reader's communities in a column beside the feed**: pinned first, then
  by last activity, each with its unread count. `Nýjast`, `Mín samfélög` and `Finna` stay as
  they are below expanded.
- **Creating a community shows the form beside a live preview** of the community header at
  the reader's own size class, so the picture, cover and name are seen in place before
  `Stofna`.
- **The member strip shows as many pictures as the header's width allows**, up to twelve; five
  on compact as today.

### What every width gets

- **`Bjóða` sits at the end of the header's actions row**, the way 0080 drew it. Today it lands
  mid-row on the web because the invite component returns three siblings into a
  `justify-between` row; this is a defect, fixed with the layout.
- **The post screen's back bar and comment composer are as wide as the post**, not the window.

### The apps

- **Android** reads the size class from `currentWindowAdaptiveInfo()` and lays out the
  navigation with a navigation suite scaffold (bar on compact, rail above). Two panes use
  the adaptive list-detail and supporting-pane layouts, so a foldable changes layout on
  unfolding without a restart.
- **iOS** reads `horizontalSizeClass` and uses a `NavigationSplitView` (iOS 17, the app's
  deployment target) for the rail and the community's aside; iPad split view and Slide Over
  get the compact layout when they are narrow.
- Rotation, resizing and unfolding keep the reader's place: the open community, the scroll
  position and a draft in the composer survive a change of size class.

## Why

On 2026-10-24 the community screens were compared at 1440, 1024 and 840 px with the desktop
groups most readers know (kept privately under 0073). Every gap but four was layout: a
phone column with a hand's width of empty space on each side, `Um samfélagið` a screen away
when the other site keeps it beside the feed, management a long page rather than a place,
and no preview when creating. 0086 already taught every client the three size classes for
the cover, so the layout keys off the same classes rather than a second definition of "wide".

The breakpoints were found typed by hand in five places across the three clients, outside the
guard that 0086 put on the frame sizes. A layout keyed to the same numbers would add more
copies, so the definition moves into the contract before any layout reads it: the groundwork
first, because a drifted breakpoint shows one frame and another layout, which no test of a
single client would catch.

## What it rules out

- A layout chosen by device model or user agent, or a separate tablet app.
- A breakpoint written by hand in a client, or a fourth size class.
- A wide layout that drops a compact feature: everything reachable on a phone is reachable at
  every width, by the same route.
- Management tools in the reading column on a wide screen: they live in `Stjórna`'s side
  navigation, as 0080 keeps them out of the reading path.
