# 0120. Feeding the import from public profiles and pages

- Status: accepted; implemented for the file and the profile feed, not yet the page feed (#461)
- Date: 2026-10-31
- Decided by: Guðröður Atli Jónsson (collection from public profiles is allowed in the product, and page sync runs on Samtak svf.'s own developer app); the design is the overseer's
- Amends: [0119](0119-importing-a-persons-own-content.md)

## Decision

**The one import core of decision 0119 gets two more feeds.** A post that arrives by more than one
route exists once, because the key is the account, the source and the source's post id. The feeds
are now:

1. An uploaded export file (0119).
2. **Collecting a person's own public profile through a third-party provider**, on a schedule the
   person turns on per connection. This is new, and it overturns 0119's "we poll nothing and scrape
   nothing".
3. **A page the person administers, through the source platform's API**, on Samtak svf.'s own
   developer app. It stays switched off until the platform has verified the business and reviewed
   the app.
4. A listed destination (0119), later.

**A person proves a profile is theirs before anything is collected.** A collector can read anyone's
public profile, and 0119 forbids importing what a person did not write. So the person gets a one-time
code and publishes it on the profile, and the first collection must find it there. Without the code
nothing is imported.

**The collector can be switched off with one setting, per environment,** and nothing else depends on
it. Off, no run starts, and what was already imported stays. This is because the source platform's
terms restrict automated collection, and the same platform decides on our developer app and on any
place as a listed destination. If collection costs us that standing, it is the part we give up.

**Collection has a monthly cost cap in the Worker's configuration.** At the cap no new run starts, and
a daily log line reports the month's spend and whether the cap stops the next run. The job health
report is about jobs that failed, and a capped month is not one.

**The provider's address, its job, and the source hosts it may read are secrets,** read by an adapter
with a generic name. Tests use synthetic items.

**A connection's first collection goes through the same preview as a file,** and later runs publish
without one, to the audience the person chose for the connection. A post left out of the preview
stays out: later runs bring in only what is newer than the newest post the person was shown, however
far back the provider answers. A preview left unpublished for 7 days is dropped, the connection with
it, and the person starts again.

**Public here only because the person chose it,** on that connection, as 0119 says. That a post was
public at the source does not make it public here, so a connection's default is friends. A wall has
no audience of its own, since audience is set per post.

**Media is copied when imported,** through the existing upload (WebP, no metadata, EU bucket),
because source addresses expire within hours. A preview may wait for days, so its images are fetched
when it is collected and held in the same EU bucket under the import's key, and they are deleted when
it is published, removed or dropped. The first version takes images. A post with a video imports its
text and a link to the original, and the preview says so.

## Why

An export file is a one-off. People who keep posting elsewhere need a sync, and the listed-destination
route waits on the source platform's answer with no date. Collecting from a public profile works
today, and it costs one adapter because the core is already idempotent. The ownership proof is what
keeps it inside 0119's rule that only a person's own content comes in.

Samtak svf. has its own app and provider account so that no credential or data of another
organisation serves this product.

## What this rules out

- Collecting a profile without the code having been found on it.
- Collecting another person's profile, or comments and reactions by others.
- Asking for a person's password on another platform.

## Open

- **Which routes stay.** The scraper and page feeds are trials that establish which routes are
  viable. They are not the final choice of cross-platform sync methods, and that choice is made
  later on what they show. Only the core is meant to last, so a route can be replaced or dropped
  without touching it.
- **Whether the source platform objects.** Its answer on the developer app and the listed-destination
  programme may turn on this. The off switch is the prepared response.
- **Legal and rights questions** go to the review before the open beta, with 0119's.
