# 0027. The Kenni client id is `@innskraning.is/spjall`

- Status: accepted
- Date: 2026-10-08
- Decided by: the maintainer, registering the production client
- Amends: [0004](0004-frozen-identifiers-vs-brand.md) (`identity.kenniClientId`)

## Decision

- **`identity.kenniClientId` is `@innskraning.is/spjall`**, in place of
  `@innskraning.is/samtak-spjall`. The team is already Samtak's (`innskraning.is`), so the
  organisation's name in the id said nothing the prefix did not.
- **The client is registered** on developers.kenni.is under Samtak's team as a _Native_
  application: public, no secret, the redirect `is.samtak.spjall:/kenni` (decision 0019), and
  its _Name_ is the brand's (`brand/hjal/brand.json`, `kenni-application-name`). Test user
  access is off.

## Why now

The old id was never registered, so no app, token or account refers to it and the change
orphans nothing. Once an app ships, every installed copy gets the id from `GET /v1/sign-in`,
but a change would still need a new client and a moment when both work. From here the id is
frozen like the others.
