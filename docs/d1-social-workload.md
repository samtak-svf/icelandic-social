# A social workload on D1

Would one D1 database hold the social platform the product decision describes (#9), with
communities, audiences and moderation (#12)? D1 caps a database at 10 GB and has one writer.
This page measures a hypothetical schema under named usage assumptions, so the records can be
argued from numbers. Nothing here is a decision.

## Answer, in short

- **Size is the limit, not speed.** At the assumptions below, the database passes 10 GiB in
  about six months and reaches about 60 GiB after three years. Reactions, comments and posts
  make up about 94% of that.
- **Every read stays fast if it is shaped right.** The slowest read measured is the
  obvious one-scan home feed: 20–40 ms and 20,000–30,000 rows read, depending on the viewer
  and the run. Its cost grows with history, so it would get about twelve times worse at
  three years. Read per source in a time window, the
  same feed costs about 1 ms and a few hundred rows, however much history there is.
- **Writes are far below the single writer's limit.** The assumed load is about 3 writes a
  second on average. One insert takes about 0.1 ms of SQLite time.
- **A community post should not fan out to its members.** Fanning out a notification costs a
  write per member, in time and in storage. Members can read the community instead.

## Method

`spikes/d1-workload/measure.ts` builds the schema and seeds rows in a throwaway local D1,
using wrangler's `getPlatformProxy`. That is the same workerd D1 that `cf dev` runs. It then
times reads and writes and measures each table's growth. The schema exists only in the
script: no migration holds it.

- **Rows are generated inside SQLite** with recursive CTEs, so seeding several million rows
  takes about two minutes.
- **Ids are 22 characters of TEXT**, the length of the Worker's 16-byte base64url ids.
- **Bodies are `x` repeated**, at an average of 280 characters for a post and 120 for a
  comment. SQLite does not compress, so the content of a body does not change its size.
  Icelandic letters take two bytes in UTF-8 and would add a little.
- **The seed is smaller than the projection:**
  - 20,000 accounts over 90 days, against 100,000 accounts over three years;
  - the same 50 accounts per community and the same activity per account.
  - As a result, a viewer sees as many communities, follows and posts per day as at the
    assumed load, and per-viewer reads match it except for one more B-tree level. Only the
    one-scan feed depends on how long the history is (see below).
- **Size per table** is the growth of D1's `size_after` while that table and its indexes are
  seeded. It is then divided by the table's rows and multiplied by the projected rows.
- **Times are SQLite's own**: D1's `sql_duration_ms`, at local workerd's 1 ms resolution. In
  production each statement also crosses the network from the Worker to the database's
  primary. That latency is not measured here and is the same for every query. The proxy's
  wall time is shown for writes only to show that it is not the database's own time.
- **Rows read** is D1's `rows_read`, which D1 also bills by.

## Assumptions

They are constants at the top of the script, and the results follow them.

| Assumption                                      | Value                                       |
| ----------------------------------------------- | ------------------------------------------- |
| Accounts                                        | 100,000                                     |
| Content kept                                    | 3 years, nothing expires                    |
| Accounts per community                          | 50 (2,000 communities), 20% of them private |
| Communities per account                         | 8, skewed: a few large, most small          |
| Posts per account per day                       | 0.2, 70% in a community, 30% to followers   |
| Comments and reactions per post                 | 3 and 8                                     |
| Follows and blocks per account                  | 50 and 0.5, follows skewed to a few         |
| Notifications (a comment or reaction on a post) | kept 90 days                                |
| A page                                          | 30 posts                                    |

## Results

Produced by `pnpm --filter spjall-spike-d1-workload measure --write` (the default seed):

<!-- results:start -->

Seed: 20,000 accounts, 400 communities, 90 days. Projection: 100,000 accounts over 1,095 days.

| Table (with its indexes) | Seed rows |   Seed size | Bytes per row | Projected rows |                   Projected size |
| ------------------------ | --------: | ----------: | ------------: | -------------: | -------------------------------: |
| accounts                 |    20,000 |     1.6 MiB |            82 |        100,000 |                         0.01 GiB |
| communities              |       400 |     0.0 MiB |            92 |          2,000 |                         0.00 GiB |
| community_members        |   157,240 |    24.3 MiB |           162 |        800,000 |                         0.12 GiB |
| follows                  |   997,529 |   147.6 MiB |           155 |      5,000,000 |                         0.72 GiB |
| blocks                   |    10,000 |     1.4 MiB |           152 |         50,000 |                         0.01 GiB |
| posts                    |   360,000 |   166.7 MiB |           485 |     21,900,000 |                         9.90 GiB |
| comments                 | 1,080,000 |   334.1 MiB |           324 |     65,700,000 |                        19.85 GiB |
| reactions                | 2,879,397 |   447.5 MiB |           163 |    175,200,000 |                        26.59 GiB |
| notifications            | 3,959,397 |   521.1 MiB |           138 |     19,800,000 |                         2.54 GiB |
| **Total**                |           | 1,644.6 MiB |               |                | **59.74 GiB** (597.4% of 10 GiB) |

At the assumed rates the database grows by about 19.91 GiB a year and reaches 10 GiB after about 0.5 years.

Communities: the biggest has 2,609 members, the median 281. Times are SQLite's own (D1's `sql_duration_ms`, no network) over 25 viewers.

| Read                               | Median ms | Slowest ms | Median rows read | Most rows read |
| ---------------------------------- | --------: | ---------: | ---------------: | -------------: |
| home feed, one scan                |      20.0 |       28.0 |           19,326 |         28,852 |
| home feed, per source in a window  |       1.0 |        1.0 |              362 |            409 |
| community page (biggest community) |       0.0 |        1.0 |              411 |            411 |
| community page (median community)  |       0.0 |        1.0 |              417 |            422 |
| a post's comments                  |       0.0 |        1.0 |               16 |             16 |
| notifications, newest first        |       0.0 |        1.0 |               30 |             30 |

Slowest read: home feed, one scan, 28.0 ms.

Rows written is D1's own count, which includes index entries.

| Write                                                        | Rows written | SQL ms | Wall ms, through the local proxy |
| ------------------------------------------------------------ | -----------: | -----: | -------------------------------: |
| 1,000 posts, one statement each                              |        1,000 |     96 |                            6,145 |
| 1,000 posts in one `batch`                                   |        1,000 |     11 |                            1,919 |
| Fan-out of one post to the biggest community (2,609 members) |        5,218 |   25.0 |                                  |
| Fan-out of one post to the median community (281 members)    |          562 |    3.0 |                                  |

Query plans, for the first viewer:

```text
home feed, one scan:
  MULTI-INDEX OR
  INDEX 1
  LIST SUBQUERY 1
  SEARCH community_members USING INDEX community_members_by_account (account_id=?)
  SEARCH p USING INDEX posts_by_community (community_id=? AND created_at<?)
  INDEX 2
  LIST SUBQUERY 2
  SEARCH follows USING COVERING INDEX sqlite_autoindex_follows_1 (follower_account_id=?)
  SEARCH p USING INDEX posts_by_author (author_account_id=? AND created_at<?)
  CORRELATED SCALAR SUBQUERY 3
  MULTI-INDEX OR
  INDEX 1
  SEARCH b USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
  INDEX 2
  SEARCH b USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
  USE TEMP B-TREE FOR ORDER BY
home feed, per source in a window:
  MERGE (UNION ALL)
  LEFT
  SEARCH m USING INDEX community_members_by_account (account_id=?)
  SEARCH p USING INDEX posts_by_community (community_id=? AND created_at>? AND created_at<?)
  CORRELATED SCALAR SUBQUERY 3
  MULTI-INDEX OR
  INDEX 1
  SEARCH b USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
  INDEX 2
  SEARCH b USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
  USE TEMP B-TREE FOR ORDER BY
  RIGHT
  SEARCH f USING COVERING INDEX sqlite_autoindex_follows_1 (follower_account_id=?)
  SEARCH p USING INDEX posts_by_author (author_account_id=? AND created_at>? AND created_at<?)
  CORRELATED SCALAR SUBQUERY 3
  MULTI-INDEX OR
  INDEX 1
  SEARCH b USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
  INDEX 2
  SEARCH b USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
  USE TEMP B-TREE FOR ORDER BY
community page (biggest community):
  SEARCH k EXISTS USING INDEX sqlite_autoindex_communities_1 (community_id=?)
  SCALAR SUBQUERY 3
  SEARCH m USING COVERING INDEX sqlite_autoindex_community_members_1 (community_id=? AND account_id=?)
  SEARCH p USING INDEX posts_by_community (community_id=? AND created_at<?)
  CORRELATED SCALAR SUBQUERY 5
  MULTI-INDEX OR
  INDEX 1
  SEARCH b USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
  INDEX 2
  SEARCH b USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
  CORRELATED SCALAR SUBQUERY 1
  SEARCH c USING COVERING INDEX comments_by_post (post_id=?)
  CORRELATED SCALAR SUBQUERY 2
  SEARCH r USING COVERING INDEX sqlite_autoindex_reactions_1 (post_id=?)
a post's comments:
  SEARCH c USING INDEX comments_by_post (post_id=?)
notifications, newest first:
  SEARCH notifications USING INDEX notifications_by_account (account_id=?)
```

<!-- results:end -->

## What the numbers say

### Size

- **The 10 GB limit is reached in months, not years.** Growth is linear in accounts, posts
  per day and days kept. 10,000 accounts at the same rates come to about 2 GiB a year.
- **Rows are mostly ids and index copies of ids.** A reaction is a post id, an account id, a
  word and a time, about 60 bytes of data. It takes 163 bytes because the primary-key index
  and `reactions_by_account` each store the two ids again. These would cut it:
  - integer keys, for example the rowid, in place of 22-character text ids;
  - `WITHOUT ROWID` for the pair tables (`reactions`, `follows`, `community_members`), which
    store the row in the primary-key index itself;
  - counting reactions in a column on the post where who reacted need not be kept.
  - Together these might halve the size. They would not bring three years under 10 GiB.
- **Holding the content at the assumed load needs one of these:**
  - content split out of the single database, for example a SQLite Durable Object per
    community, each with its own limit;
  - content that expires or moves to R2;
  - or a lower ceiling than these assumptions.
  - The social graph (accounts, memberships, follows, blocks) is about 0.9 GiB at the
    horizon and fits easily.

### Reads

- **The one-scan home feed reads every post its sources ever made.**
  - It filters posts by membership OR follow and sorts the result. SQLite resolves the OR
    with one index range per source (`MULTI-INDEX OR`), collects every matching row from
    the whole history, then sorts it (`USE TEMP B-TREE FOR ORDER BY`).
  - At 90 days that is about 20,000 rows read for a median viewer. At three years it would
    be roughly twelve times as many, about 300 ms and 300,000 rows read per page. That figure
    is extrapolated, not measured.
- **The windowed feed is the form to use.**
  - It reads a time window from each source with `UNION ALL`, using `posts_by_community`
    and `posts_by_author` as ranges on both ends, and steps back a window when a page is
    short.
  - Its cost is set by how many sources a viewer has, not by how much history there is.
- **The community page** reads its 30 posts plus their comments and reactions to count them
  (about 400 rows). A counter column on the post would bring that to about 30.
- **Blocks in both directions are checked once per candidate post.** The primary key
  `(blocker, blocked)` answers both directions, because the check names both columns each
  time. The feed does not need `blocks_by_blocked`. Only a list of who blocked an account
  would.

### Writes

- **Writes are fast for the database.** One post insert takes about 0.1 ms of SQLite time
  on its own, and about 10 µs inside a `batch`.
- **The assumed load writes little.** That is 20,000 posts and 220,000 comments and reactions
  a day, about 3 writes a second on average. The single writer would be busy well under 1%
  of the time. A burst of a few hundred writes a second is still small.
- **The cost of a write is the round trip.** A Worker that writes one statement at a time
  waits for the network once per statement. A `batch` waits once.

### Fan-out

- **A notification per member costs a row per member.** Writing one notification for each
  member when a post lands in the largest community (about 2,600 members) takes about 25 ms of the
  single writer, plus about 140 bytes per member.
- **Pushing every community post to every member multiplies storage.** At the assumed rates
  that is about 14,000 community posts a day, each sent to a community of 400 members on
  average. That comes to about 5.6 million rows a day, some two billion a year, which is far
  larger than the content itself.
- **Members read their communities instead.** This is the windowed feed above, and it writes
  nothing.
- **What deserves a notification row** is something addressed to one person: a comment or
  reaction on their post, a mention, a reply.

## Indexes the reads need

Every query plan above is an index search. No query scans a table.

- `community_members_by_account (account_id)`: the communities a viewer belongs to. The
  primary key `(community_id, account_id)` answers whether a viewer is a member.
- `posts_by_community (community_id, created_at)`, partial on `community_id IS NOT NULL`:
  a community page, and the community half of the feed.
- `posts_by_author (author_account_id, created_at)`: the follow half of the feed, and a
  profile.
- `comments_by_post (post_id, created_at)`: a post's comments, and their count.
- The `reactions` primary key `(post_id, account_id)`: a post's reactions, and one reaction
  per account.
- The `follows` primary key `(follower, followee)`: whom a viewer follows.
  `follows_by_followee` serves a followers list.
- The `blocks` primary key: both directions of the block check.
- `notifications_by_account (account_id, created_at)`: the notification list.

Not needed: an index on `posts (created_at)` alone. The windowed feed never reads all posts
by time, and the one-scan feed is the one not to use.

## For #9 and #12

- **#9:** one D1 holds the social graph and every read and write path measured here. It
  does not hold three years of content at these assumptions. The record should state where
  content lives once the single database is full: split per community, expiry, or R2.
- **#12:** community pages and access checks (open, or a member) are cheap index lookups.
  Private communities cost nothing extra to read. Community posts should reach members by
  reading, not by fan-out.

## The feed at the size of 0116 (#373)

Decision [0116](decisions/0116-the-feed.md) estimated about 1,500 rows per page for a viewer with 500 friends
and 50 communities, by arithmetic. This section measures it. The figures come from
`spikes/d1-workload/feed.ts`, on **a local D1 in workerd (`getPlatformProxy`)**: rows read is D1's own
`rows_read`, milliseconds are D1's `sql_duration_ms` (SQLite, no network), the mean of 20 runs of the same
statement. **No figure here is from production D1**, which adds a network hop per statement and was not
created for a spike. The seed is the full 100,000 accounts, so the table of 5 million `friendships` rows is
the size 0114 projects, not a scaled-down copy.
**The result: the heavy viewer reads 2,346 to 2,401 rows a page (four complete runs; 2,378 in the table), under the 3,000 that
would call for a change, so 0116 stands.** The estimate of 1,500 was about 900 rows too low. The difference fits how
`rows_read` counts, not a different plan: a row found through an index costs the index entry and the table row, so
the roughly 380 posts in the first day count about 760, the 500 friendships 500 and the 500 walls about 1,000 (the
`walls` primary key is on `account_id`, so the wall's table row is read too), which with the memberships comes to the
measured figure. That split is arithmetic checked against the total, not a per-table count. The plan is the one 0116
describes.

### What differs from the document

- **Schema.** `friendships(account_id, friend_id, since)` is `WITHOUT ROWID` with the primary key
  `(account_id, friend_id)`, written in both directions (0114). `walls(account_id PRIMARY KEY, community_id)`
  (0115). `person_snoozes(account_id, target_id, until)` (0114). `post_index` gains `audience`; the feed does
  not read it (friends read both audiences, 0116). A wall is a row of `communities` with `kind = 'wall'`.
  `walls` and the wall rows of `communities` are not in a migration yet, so they exist only in the spike.
- **`posts_by_author` is `ON post_index (author_id)`**, as `backend/migrations/0015_social.sql:15` has it,
  where the earlier model above assumes `(author_account_id, created_at)`. The feed does not use it either way:
  it reaches posts through `posts_by_community (community_id, created_at)`, with a wall's id as the community.
  `posts_by_author` serves the person screen and account deletion, and a wall page read by author would
  filter on `created_at` after the index. This is a difference to know about, not one to fix here.
- **The seed holds 30 days** of posts (600,000 `post_index` rows: 7 a day per community, 0.06 a day per wall),
  the longest window the feed reads. Friendships are random pairs, 4,999,540 rows after the primary key removes
  repeats. Community memberships are 8 per account.
- **The three viewers are set exactly**, not drawn: heavy has 500 friends, 50 communities, 5 snoozed and 5
  blocked accounts; median 50 friends, 8 communities, 1 snoozed and 1 blocked; light 3 friends and no community
  (0.18 posts a day among them, so no window under 30 days fills a page). "Median" is the assumed 50 friends and
  8 communities, not the median of the seeded degrees.
- **The statement** is the one of 0116: communities (joined to `communities` for `kind` and `deleted_at`),
  friends' walls, the own wall, joined to `posts_by_community` in a window, with `state = 'visible'`, the block
  check of `UNBLOCKED` in both directions and the snooze check (`until > now`) in the same statement,
  `ORDER BY created_at DESC, post_id DESC LIMIT 31`.
- **The adaptive window** tries 1, 4, 16 and 30 days, each a fresh read of the whole window, stopping when 31
  rows come back. The Worker spends at most three statements a request, so a page that needs the 30-day window
  takes a second request, and the table counts both.

<!-- feed:start -->

Seed: 100,000 accounts, 2,000 communities, 30 days of posts. Engine: local D1 in workerd (`getPlatformProxy`), rows read is D1's `rows_read`, milliseconds are D1's `sql_duration_ms` (SQLite, no network), the mean of 20 runs.

| Table             |      Rows |
| ----------------- | --------: |
| accounts          |   100,000 |
| communities       |   102,000 |
| community_members |   798,686 |
| friendships       | 4,999,638 |
| walls             |   100,000 |
| person_snoozes    |         6 |
| blocks            |         6 |
| post_index        |   600,000 |

| Viewer | Friends | Communities | Snoozed | Blocked |
| ------ | ------: | ----------: | ------: | ------: |
| heavy  |     500 |          50 |       5 |       5 |
| median |      50 |           8 |       1 |       1 |
| light  |       3 |           0 |       0 |       0 |

Every window, alone (a statement reading the whole window, 31 rows at most returned):

| Viewer | Window | Rows read |    ms | Rows returned |
| ------ | -----: | --------: | ----: | ------------: |
| heavy  |    1 d |     2,378 |  1.30 |            31 |
| heavy  |    4 d |     4,627 |  3.55 |            31 |
| heavy  |   16 d |    13,703 | 10.75 |            31 |
| heavy  |   30 d |    24,232 | 16.45 |            31 |
| median |    1 d |       310 |  0.35 |            31 |
| median |    4 d |       633 |  0.90 |            31 |
| median |   16 d |     2,072 |  1.95 |            31 |
| median |   30 d |     3,806 |  3.60 |            31 |
| light  |    1 d |        15 |  0.15 |             0 |
| light  |    4 d |        16 |  0.10 |             1 |
| light  |   16 d |        17 |  0.00 |             2 |
| light  |   30 d |        31 |  0.05 |             9 |

A page, widening from 1 day until it fills (30 posts and one more), 3 statements to a request:

| Viewer | Window reached | Statements | Requests | Rows read per page | ms per page | Rows returned |
| ------ | -------------: | ---------: | -------: | -----------------: | ----------: | ------------: |
| heavy  |            1 d |          1 |        1 |              2,378 |        1.35 |            31 |
| median |            1 d |          1 |        1 |                310 |        0.60 |            31 |
| light  |           30 d |          4 |        2 |                 79 |        0.20 |             9 |

Query plan, heavy viewer, one window:

```text
MERGE (UNION ALL)
LEFT
MERGE (UNION ALL)
LEFT
SEARCH m USING INDEX community_members_by_account (account_id=?)
SEARCH c USING INDEX sqlite_autoindex_communities_1 (community_id=?)
SEARCH p USING INDEX posts_by_community (community_id=? AND created_at>? AND created_at<?)
CORRELATED SCALAR SUBQUERY 4
MULTI-INDEX OR
INDEX 1
SEARCH blocks USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
INDEX 2
SEARCH blocks USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
CORRELATED SCALAR SUBQUERY 5
SEARCH z USING INDEX sqlite_autoindex_person_snoozes_1 (account_id=? AND target_id=?)
USE TEMP B-TREE FOR ORDER BY
RIGHT
SEARCH f USING PRIMARY KEY (account_id=?)
SEARCH w USING INDEX sqlite_autoindex_walls_1 (account_id=?)
SEARCH p USING INDEX posts_by_community (community_id=? AND created_at>? AND created_at<?)
CORRELATED SCALAR SUBQUERY 4
MULTI-INDEX OR
INDEX 1
SEARCH blocks USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
INDEX 2
SEARCH blocks USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
CORRELATED SCALAR SUBQUERY 5
SEARCH z USING INDEX sqlite_autoindex_person_snoozes_1 (account_id=? AND target_id=?)
USE TEMP B-TREE FOR ORDER BY
RIGHT
SEARCH w USING INDEX sqlite_autoindex_walls_1 (account_id=?)
SEARCH p USING INDEX posts_by_community (community_id=? AND created_at>? AND created_at<?)
CORRELATED SCALAR SUBQUERY 4
MULTI-INDEX OR
INDEX 1
SEARCH blocks USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
INDEX 2
SEARCH blocks USING COVERING INDEX sqlite_autoindex_blocks_1 (blocker_account_id=? AND blocked_account_id=?)
CORRELATED SCALAR SUBQUERY 5
SEARCH z USING INDEX sqlite_autoindex_person_snoozes_1 (account_id=? AND target_id=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

<!-- feed:end -->

### What the figures say

- **The heavy viewer never widens.** One day holds 380 posts in its sources, so the first statement fills the
  page: about 2,400 rows and 1.2 to 1.5 ms. That is the figure for every page that starts at the top of the feed.
- **Under the ceiling by about 600 rows.** A viewer who passes 3,000 rows needs the first window cut to 12 hours or
  the page shortened, not a different query; neither is needed at this size.
- **A wider window is the thing to avoid for the heavy viewer.** If a day ever came back short, the 4 and 16 day
  windows would read about 4,600 and 13,800 rows and the 30 day window about 24,300, at 3 to 16 ms. The adaptive
  window exists so that this never happens to the viewer who has the most to read.
- **The median viewer** reads about 300 rows and 0.2 to 0.6 ms for a page, and would need the 30-day window (about 3,800
  rows, 3 ms) only if its sources went quiet.
- **The light viewer** reads 65 to 80 rows and under 0.4 ms across four statements and two requests, and ends with
  three to nine posts: the window reached 30 days and still did not fill a page. Four statements and two requests is
  the cost of a quiet account, and it is small because the sources are few.
- **The plan** reads each source through an index and sorts the merged rows in a temporary B-tree
  (`USE TEMP B-TREE FOR ORDER BY`), once for each of the three sources. The sort is of the rows in the window,
  not of the table.
- **Not measured:** production D1's network and queueing, the 30 Space calls per page (those need staging, as
  0116 says), and a viewer with far more than 500 friends.

## Reproducing

```bash
pnpm install
pnpm --filter spjall-spike-d1-workload measure                    # print the results (about two minutes)
pnpm --filter spjall-spike-d1-workload measure --accounts 2000    # a quick, smaller seed
pnpm --filter spjall-spike-d1-workload measure --write && pnpm format   # refresh the results above
```

Change an assumption in the constants at the top of `spikes/d1-workload/measure.ts`, then run
it again. The seed draws from SQLite's `random()`, so the counts move by a few percent from run
to run. Times also vary from one machine to another. The sizes per row hardly move.

The feed section above is a separate script, with its own seed (one to four minutes at 100,000
accounts, and it starts again by itself, up to twice, if workerd drops its connection mid-seed, in `$HOME/.cache/spjall-spike`, deleted when it ends; it needs about 3 GiB of disk and does not
read the first script's database):

```bash
pnpm --filter spjall-spike-d1-workload measure:feed                      # print the results
pnpm --filter spjall-spike-d1-workload measure:feed --write && pnpm format   # refresh the table in that section
pnpm --filter spjall-spike-d1-workload measure:feed --accounts 10000     # a quick, smaller seed (the minimum)
```
