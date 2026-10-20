# Security

## Reporting a vulnerability

Report it privately through **Report a vulnerability** on this repository's Security tab
(GitHub private vulnerability reporting), or by email to `samtak@samtak.is`. Please do not
open a public issue or pull request for it.

Include what you found, how to reproduce it, and what an attacker could do with it. You will
get an answer within a week.

## Scope

The project is in closed beta: the Worker and the web app run at `https://spjall.samtak.is`,
and the Android and iOS apps are distributed to testers through Google Play internal testing
and TestFlight ([decision 0009](docs/decisions/0009-v1-scope.md),
[decision 0060](docs/decisions/0060-a-social-platform-with-an-encrypted-messenger.md)).

Reports are welcome across the whole system:

- End-to-end encrypted 1:1 and group messaging (MLS via OpenMLS in `core/mls`, envelope
  framing in `core/envelope`, SQLCipher local storage in `core/store`, sync and membership
  checks in `core/client` and `backend/src/modules/messaging/`);
- Authentication, sessions and account linking (`backend/src/identity/`,
  [decision 0035](docs/decisions/0035-google-only-sign-in-and-merge-on-kenni.md),
  [decision 0061](docs/decisions/0061-account-identity-session-and-device-are-separate.md),
  [decision 0062](docs/decisions/0062-the-web-host-and-its-sign-in-callbacks.md),
  [decision 0069](docs/decisions/0069-web-kenni-links-not-signs-in.md));
- Hosted communities, media re-encoding and moderation (`backend/src/modules/communities/`,
  `backend/src/modules/social/`, `backend/src/modules/moderation/`,
  [decision 0063](docs/decisions/0063-communities-audiences-and-moderation.md),
  [decision 0065](docs/decisions/0065-the-space-object-and-social-media.md),
  [decision 0066](docs/decisions/0066-moderation-in-d1.md),
  [decision 0070](docs/decisions/0070-community-deletion-and-declined-requests.md));
- The web app (`web/`, CSP and security headers in `web/src/security-headers.ts`), the phone
  apps (`android/`, `ios/`), the build pipeline, the workflows and the repository guards
  (`tooling/`).

The code has not been reviewed by an independent third party.

## What the repo holds

No secret, signing key, personal data or production configuration is in the repo. Secrets
live outside it and reach CI only through GitHub secrets and environments. `pnpm check`
refuses an Icelandic kennitala or phone number, and gitleaks runs before every commit and
in CI.
