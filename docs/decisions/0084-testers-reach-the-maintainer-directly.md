# 0084. Testers reach the maintainer directly

- Status: accepted; implemented 2026-10-24
- Date: 2026-10-24
- Decided by: Guðröður Atli Jónsson
- Supersedes: [0076](0076-an-assistant-for-testers.md) (an automated assistant answers testers and queues them for the tester lists)

## Decision

A would-be tester sends the maintainer a direct message. The maintainer asks for two things:
the email address and the platform. On Android that is the Gmail address used in the Play Store.
On iPhone it is the Apple ID address. The maintainer then adds the tester by hand:

- **iPhone:** a TestFlight invite. The tester gets an App Store Connect user with the role
  **Marketing** only, with access limited to the beta app. After the tester accepts the
  invitation, the maintainer adds them to the internal TestFlight group. Changing any user's
  role removes that user from the internal groups, so the maintainer adds them again
  afterwards.
- **Android:** the tester is added to the Play internal-test list only; they get no console
  access. The maintainer sends the Play internal-test link. The tester opens it in Chrome,
  signs in with that Gmail address, accepts, and installs. On an error they wait about 30
  minutes and try again.

The automated assistant of decision 0076 is removed from the Worker, the backend scripts, the
brand strings and the docs, and nothing replaces it.

## Why

The assistant made testers wait on a queue and a model for what is one message to a person,
and it put a community's text in front of a model provider outside the EU (the exception 0076
made to decision 0001). A direct message needs no account of a special kind, no queue, no key
for the maintainer's machine and no monthly cost.

## Rules out

- The assistant: its account kind, its job, its replies and the community it answered in.
- Its model cost, and the `ANTHROPIC_API_KEY` secret with the `@anthropic-ai/sdk` dependency.
- The tables `tester_requests`, `assistant_usage` and `assistant_answers`, which migration 0026
  drops (the `accounts.kind` column stays, with its one value in use, `person`), and the routes `/ops/assistant/*`, `/ops/testers/*`
  and `/ops/mcp`.
- The App Store Connect key on the maintainer's machine for a timer; a tester is added in the
  App Store Connect and Play consoles.
- The exception to decision 0001 and the entry in decision 0009's table that 0076 added: no
  community text reaches a model provider.

## Implementation

Done 2026-10-24: the module, job, `/ops` routes, script, vars, secret and strings are deleted,
and migration 0026 drops the assistant's tables. Migration 0021 stays, as migrations are append-only.
