# 0029. KeyPackages have a lifetime the server reads and the core keeps ahead of

- Status: accepted; implemented in the backend (#103) and the core (0.10.0: the lifetime
  constant, restocking from `sync()`, `Expired`)
- Date: 2026-10-09
- Decided by: the maintainer, approving the plan that acted on architecture review #100
- Amends: [0002](0002-mls-end-to-end-encryption.md) (the replenish threshold),
  [0017](0017-conversations-on-the-server.md) (what `{available}` counts, and the claim)

## Decision

Every KeyPackage expires 84 days after it is made (OpenMLS's default), and nothing restocked
or dropped an expired one. An account active for twelve weeks became impossible to add, and
the adder saw only `Malformed("KeyPackage")` from its own core.

- **The lifetime is explicit.** `core/mls` builds every KeyPackage, the last resort included,
  with `KEY_PACKAGE_LIFETIME` = 84 days. A change of the constant is a change of this record.
- **The Worker reads `not_after` from the package**, from the leaf node's `key_package`
  source, and never from a field the client sends.
  - An upload with a package that has expired, or whose `not_after` is more than 90 days
    away, is refused (`400 invalid_request`).
  - D1 stores `not_after` per row. A row stored before this record counts as
    `created_at + 84 days`.
  - A claim never hands out a package that expires within a day. When an active device of the
    account has nothing valid, it is left out of the answer. When no device has anything
    valid, the claim answers `409 no_key_packages`.
  - The daily cron deletes expired rows, last resorts included.
- **The stock answer says what the core needs to keep ahead.** `{available}` counts packages
  valid for at least 14 more days, and `lastResortNotAfter` is the last resort's expiry, or
  null when there is none.
- **The core restocks itself.** `sync()` runs `stock_key_packages` at most once a day. Stock
  tops up below the target and replaces the last resort when it expires within 14 days. The
  apps' call at launch stays.
- **An expired package is named.** `add()` maps a lifetime failure to `GroupError::Expired`,
  not `Malformed`.

## Why

A KeyPackage's lifetime bounds how long a stolen init key is useful, so letting packages live
for ever is not the fix. The fix is that the device keeps fresh ones on the server, and that
the server never hands out what the adder's core will refuse. Reading `not_after` from the
signed package keeps the server's view equal to what the adder checks, with no field the
client could get wrong.

## Rules out

- Packages with no expiry, or a last resort that never expires.
- The server handing out a package that it knows has expired.
- Trusting a client-sent expiry.

## Known limits

- A device that is not opened for more than 84 days has no valid package. It cannot be added
  to a new group until it is opened again, and the adder is told `no_key_packages`.
