# 0083. The app is self-classified 5D992.c, and no report goes to BIS

- Status: accepted
- Date: 2026-10-23
- Decided by: Guðröður Atli Jónsson
- Amended by: [0085](0085-the-stores-offer-the-app-in-iceland-only.md) (Iceland only, so no French declaration)
- Amends: [0002](0002-mls-end-to-end-encryption.md) (§ Export compliance, the year-end report)

## Decision

- **The apps and the web app are self-classified as ECCN 5D992.c** under License Exception
  ENC, EAR §740.17(b)(1). They are end-user mass-market software that meets the Cryptography
  Note (Note 3 to Category 5, Part 2): they are offered to the public, the user cannot change
  their cryptography, and they install without the supplier's help.
- **No self-classification report is filed.** Since 86 FR 16482 (29 March 2021),
  §740.17(e)(3) covers only mass-market _components_, `executable software` of a hardware
  component, and items that stay in 5A002, 5B002 or 5D002. An end-user app is none of these.
- **No source code notification is sent.** The repository is public (§734.3(b)(3)). Under
  §742.15(b)(1) its encryption source code is not subject to the EAR. The email that
  §742.15(b)(2) asks for applies only to "non-standard cryptography", and the core uses
  standard algorithms only: MLS (RFC 9420) with X25519, Ed25519, AES-128-GCM and SHA-256,
  AES-256-GCM for media, and SQLCipher for the local store.
- **The classification is kept as a record** (EAR part 762) and is shown to BIS only if asked.
  The record lists the product, the ECCN, the algorithms with the code that uses them, and the
  public source.
- **Nothing else in 0002 changes.** `ITSAppUsesNonExemptEncryption` stays `NO`, and offering
  the app in France still needs the declaration and its code in the bundle. As of 2026-10-24 the app is not
  offered in France ([0085](0085-the-stores-offer-the-app-in-iceland-only.md)).

## Why

0002 said the US mass-market rule still asks for a year-end report. That reading predates the
2021 rule, whose title is _Elimination of Reporting Requirements for Certain Encryption Items_.
The current text of §740.17(e)(3) and its note, read on 2026-10-23, leave end items out. Filing
a report that is not required costs nothing, but a release gate waiting on one would hold back
the public release for a step that does not exist.

## What it rules out

- A yearly report to BIS for the apps, unless the product becomes a component, a
  non-mass-market item, or uses non-standard cryptography. Any of these would call for a new
  record.
- Treating the export declaration in 0009's release gate as open on account of a BIS filing.
