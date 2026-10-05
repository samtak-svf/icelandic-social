# 0010. The app ships from Samtak svf.'s own store accounts

- Status: accepted
- Date: 2026-10-05 (Play owner revised the same day)
- Decided by: Guðröður
- Closes: 0004 § Open
- Amended by: 0011 (interim TestFlight builds on `B4724Z74TM` under their own ids)

## Decision

- **Apple:** a new Apple Developer Program enrollment for Samtak svf. as an organisation. No
  App ID, App Group or APNs key is registered on the party's team `B4724Z74TM`.
- **Google Play:** a Play Console Organization account owned by a Google account created on
  `samtak@samtak.is`, which is also the developer contact address shown on Play.
  `samtak@samtak.is` is a Cloudflare Email Routing address on `samtak.is`; a Google account
  can be made on any existing address.
- **Before that account owns anything,** it has two-step verification and a way back in that
  does not depend on mail, kept outside the repo.
- **One D-U-N-S number for Samtak svf.** is requested first; both enrollments need it.
- **`services.appleTeamId` is `null`** in `identifiers/ids.json` until the team exists. The
  real id goes in by a lock edit that cites this record. A null cannot be mistaken for a real
  team: debug builds stay unsigned, and the iOS release workflow refuses to sign while it is
  null.
- **Admin invites (0009) are minted only by account ids on a server-side list in D1.** The list
  is never a list of kennitölur (0008). At first it holds Guðröður's account only.

The steps, the filing data and the pitfalls are in
[`docs/store-accounts/`](../store-accounts/README.md).

## Why

A bundle id belongs to the team that registers it, and moving an app between teams means new
push keys, new provisioning, and on Apple a transfer that drops some settings. The Rósa Parks
severance showed what it costs when a product lives on another organisation's accounts. An
owner tied to the organisation's address, not to one person, survives a change of people;
a Play account's owner can never be changed.

The owner was briefly written as the félag's older Google account, which carries its old name
and a payments profile that does not match the D&B name `Samtak svf.`. An owner that can never
be changed should carry the name the félag will keep. On `samtak.is` the owner, the public contact
and the verified website are one domain, Google asks fewer verifications of an owner on the
website's domain, and the new account gets a payments profile made from the D&B record.

The cost is that mail to the owner depends on Cloudflare Email Routing for `samtak.is`; the
two-step verification does not use mail, so it covers a broken rule. A lapsed `samtak.is` would
already break Play's website verification, so the owner adds no dependency the account did not
have.

## Rules out

- Registering anything for `is.samtak.spjall` on `B4724Z74TM`, including as a stopgap.
- A personal Google account as the Play Console owner.
- Signing a release build while `appleTeamId` is `null`.
