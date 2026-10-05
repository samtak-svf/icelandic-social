# 0008. No personal data in logs

- Status: accepted
- Date: 2026-10-05

## Decision

Nothing that identifies a person goes into a log, a crash report, an error message returned
to a client, or an analytics event: no kennitala (hashed or not), phone number, name,
message content or metadata beyond ids, push token, IP address, or Kenni token. A log line
carries opaque ids (`deviceId`, `conversationId`, `seq`), counts, durations and error codes.

The same holds for the repo: kennitölur and phone numbers never enter git
(`tooling/pii-guard.mjs`, pre-commit and CI).

## Why

Workers Logs and Crashlytics are processed outside the EU jurisdiction boundary of decision
0001, so a personal field in a log line moves data where the residency sentence says it is
not kept. A log that carries no personal data also needs no retention policy of its own.

## Enforcement

The pii-guard covers the repo. In the backend, logging goes through one helper in
`src/log.ts` that accepts a typed record of allowed fields, and the seam guard refuses
`console.*` elsewhere (backend PR).

## Rules out

`console.log(request)`, logging a request or response body, logging a Kenni ID token or
its claims.
