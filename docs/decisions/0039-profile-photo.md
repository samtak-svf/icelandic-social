# 0039. One profile photo per account, seen by every signed-in account, not end-to-end encrypted

- Status: accepted; implemented in the backend (#176), the core (#177) and the apps (#184)
- Date: 2026-10-10
- Decided by: the maintainer, choosing it from a comparison with an established messenger
- Builds on: [0001](0001-eu-storage-and-residency-wording.md), [0004](0004-frozen-identifiers-vs-brand.md),
  [0008](0008-no-pii-in-logs.md), [0023](0023-media-as-encrypted-blobs.md),
  [0034](0034-fljotid-and-the-wall.md), [0036](0036-everyone-signed-in-is-in-the-picker.md)
- Amends: 0009 (identity shown: a profile photo joins the name and mark), 0024 (block
  extends to the photo)
- Adds a frozen id: `cloudflare.r2.profiles` = `spjall-profiles` (`identifiers/ids.json` and
  its lock, in this PR)

## Decision

- **An account has at most one photo.** Its owner sets, replaces or removes it from "Ég".
  A new photo overwrites the old one; no earlier photo is kept anywhere.
- **The photo is not end-to-end encrypted.** It is shown to every signed-in account, as the
  name already is (0034, 0036), so there is no audience to keep it from, and the server must
  read it to re-encode it. The screen that sets it says in one line that everyone signed in
  sees it.
- **The server re-encodes every upload to one fixed size**, a 512 by 512 px square WebP,
  through the Worker's Cloudflare Images binding (offered by `cf/config`, the package
  `backend/cloudflare.config.ts` is written in); Images writes WebP without metadata, and a
  test holds that a photo with a GPS tag comes back without one. Images transforms and keeps
  nothing, which is processing on Cloudflare's network as 0001 already says. Only the
  re-encoded image is stored, so EXIF location, the camera and the original resolution never
  reach storage. The app crops to a square and scales down before upload to keep the upload
  small, but the server's re-encode is the guarantee, since a client cannot be trusted to
  strip anything. An upload over 10 MB, or one Images cannot decode, is refused.
- **It is stored in a new R2 bucket, `spjall-profiles`, created in the EU jurisdiction**
  (`cf r2 buckets create --name spjall-profiles --cf-r2-jurisdiction eu`, the owner's step,
  as with the first bucket), keyed by account id. A key prefix in `spjall-media` is not
  sound: that bucket's lifecycle rule has the empty prefix and deletes every object after 31
  days (`backend/README.md`, the first-deploy steps), media objects are keyed by their bare
  `mediaId` (`backend/src/media.ts`, `putMedia`), and an R2 lifecycle condition selects only
  by prefix, so the rule cannot be told to spare a photo without re-keying every media
  object. Apart from that, `spjall-media` holds only ciphertext that expires in 30 days
  (0023), and a bucket of plaintext kept indefinitely would break both facts. The new bucket
  has no lifecycle rule. The name is a frozen id, added with this record (0004);
  `tooling/jurisdiction-check.mjs` holds it to the EU once the Worker binds it.
- **D1 `accounts` gets `photo_version`**, null when there is no photo: an opaque token that
  changes with each upload. `Profile` (`backend/src/api/accounts.ts`), and with it
  `GET /v1/accounts/{accountId}`, `GET /v1/people` and the authors in Fljótið, gains
  `photo`, that token or null. The core caches a photo by account and version and fetches it
  only when the version changes.
- **Routes**, each with a device token:
  - `PUT /v1/me/photo` takes the image bytes, rate limited per account like posts;
    `DELETE /v1/me/photo` removes it.
  - `GET /v1/accounts/{accountId}/photo` returns the stored WebP to any signed-in account.
    There is no public or signed URL, and the link host's invite page
    (`backend/src/link.ts`) never shows it.
- **Block** (0024): the photo is withheld both ways, as the directory's blocks are (0036).
  An account the owner blocked, or one that blocked the owner, gets `photo: null` and a
  `404` on the photo route, the answer for an account with no photo, so the photo does not
  say who blocked whom. The name stays visible as 0024 requires for shared groups; the photo
  is not needed for that.
- **Deleted with the account.** `DELETE /me` (`deleteAccount`, `backend/src/accounts.ts`)
  deletes the object before the account row, next to `deleteAccountMedia`.
- **No log line carries the image or its version with an account id** (0008); a log line
  says that a photo was set or removed, with the account id and a size.
- **The apps draw it in `Avatar`** (`android/app/src/main/kotlin/samtak/spjall/ui/People.kt`,
  `ios/App/UI/People.swift`), from the path the core returns, with the initials as the
  fallback while it loads and when there is none. `AvatarKind` still sets the ring for a
  verified name. A group's avatar stays initials.
- **Moderation.** A photo is a stronger vector for abuse than a name. Report and moderation,
  already in 0009's gate for a public release, cover photos too; because the photo is
  plaintext, an operator can remove one without the owner's device.

## Why

A face beside a name is how people tell each other apart in a list, and Fljótið and the
picker now show names to everyone signed in. Encrypting a photo meant for every account
would protect it from no one except the server, which then could not strip its metadata,
and stripping is what protects the person: a phone photo carries where it was taken. A
separate bucket costs one frozen id, and keeps the media bucket's two rules (ciphertext
only, gone in 30 days) true without exceptions.

## Rules out

- A photo shown before sign-in: on the link page, in a public URL, or in a directory open
  to anyone.
- Keeping earlier photos, or a history of them.
- Storing an upload as it was sent, or any of its metadata.
- A photo in `spjall-media`, or in any bucket outside the EU.
- Photos for groups, or in posts (still 0034), without their own record.
