# Security

## Reporting a vulnerability

Report it privately through **Report a vulnerability** on this repository's Security tab
(GitHub private vulnerability reporting), or by email to `samtak@samtak.is`. Please do not
open a public issue or pull request for it.

Include what you found, how to reproduce it, and what an attacker could do with it. You will
get an answer within a week.

## Scope

The project is in phase 0: nothing is deployed and no app is published, and end-to-end
encryption is designed but not implemented ([decision 0002](docs/decisions/0002-mls-end-to-end-encryption.md)).
Reports about the design, the build pipeline, the workflows or the guards are welcome now.

## What the repo holds

No secret, signing key, personal data or production configuration is in the repo. Secrets
live outside it and reach CI only through GitHub secrets and environments. `pnpm check`
refuses an Icelandic kennitala or phone number, and gitleaks runs before every commit and
in CI.
