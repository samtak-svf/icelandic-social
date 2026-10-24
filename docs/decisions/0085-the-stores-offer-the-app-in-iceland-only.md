# 0085. The stores offer the app in Iceland only

- Status: accepted; designed, not yet implemented (the availability is set when the public listings are created)
- Date: 2026-10-24
- Decided by: Guðröður Atli Jónsson
- Amends: [0002](0002-mls-end-to-end-encryption.md) (§ Export compliance, France),
  [0083](0083-no-bis-self-classification-report.md) (the France line)

## Decision

- **The app is for the Icelandic market.** Its public listing on Google Play and on the App
  Store is available in Iceland only: Play's country list for the production track and the
  App Store's availability both name Iceland and no other country.
- **No French cryptology declaration is filed.** 0002 and 0083 asked for one only if the app
  is offered in France, and it is not. `ITSAppUsesNonExemptEncryption` stays `NO`, and no
  `ITSEncryptionExportComplianceCode` goes in the bundle.
- **Testing is not a market.** Internal and TestFlight testers are named people invited by
  the maintainer; the store availability does not limit them and this record does not change
  how they are added (0084).

## Why

The app serves an Icelandic community and is written in Icelandic. Offering it elsewhere
brings each country's rules with it, the French declaration first among them, and gains no
user the product is for. The US self-classification of 0083 stands either way: it covers the
software, not where it is sold.

## What this rules out

- Listing the app in any other country without a new record. Such a record re-opens the
  French declaration (0002) and any other country's equivalent before the listing changes.
