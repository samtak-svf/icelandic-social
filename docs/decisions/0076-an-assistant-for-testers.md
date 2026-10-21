# 0076. An automated assistant answers testers and queues them for the tester lists

- Status: accepted; implemented in the Worker and `backend/scripts/testers.ts`
- Date: 2026-10-21
- Decided by: Guðröður
- Amends: [0001](0001-eu-storage-and-residency-wording.md) (one community's posts reach a model provider),
  [0009](0009-v1-scope.md) (an automated account, outside its table)

## Decision

The product has testers, not users, and every tester is recruited through one community.
An automated account answers there, and code with no model in it puts testers on the lists.

- **One community, named by a var.** `ASSISTANT_COMMUNITY_ID` names the community the assistant
  answers in. It is a var, not a frozen id. A post or comment anywhere else reaches no model, and an
  empty var turns the assistant off.
- **An account of its own kind.** `accounts.kind` is `person` or `assistant`, and at most one
  account is the assistant (a partial unique index). It holds no identity, so no sign-in reaches
  it, and the sweep of accounts without one (`orphans`) skips it. `POST /ops/assistant/account`
  creates it once and makes it a member of the community. Its display name says it is automated.
- **The model answers; it does not decide.** A comment, or a post by a member who is not one of
  the community's moderators (theirs are announcements), wakes a job (`assistant`, keyed by its
  id, decision 0067). The job finds an address in it with a parser, and the
  parser alone queues it in `tester_requests`. The model is then given the thread with every
  address masked and may answer once, or reply `ÞÖGN` to stay silent. It has no tools: nothing it
  writes adds, removes or reaches anyone. Each answered post or comment is recorded in
  `assistant_answers` in the batch that posts the answer, so a job run twice answers once. The
  assistant's own comments wake no job.
- **The model is Claude Sonnet, within a monthly cap.** The Worker calls the Claude API with
  `ANTHROPIC_API_KEY` (vault `samtak-spjall-anthropic-api-key`). `assistant_usage` counts the
  calls, tokens and cost per calendar month (UTC), and before each call the month's cost is
  checked against `ASSISTANT_MONTHLY_CAP_USD` (10). Over the cap the job ends with no answer,
  counts a refusal and logs `assistant.over_cap`.
- **Android testers join an open Google Group.** Play's internal track takes Google Groups,
  never single addresses. The group is linked to the track, and its address is the var
  `ASSISTANT_ANDROID_GROUP_URL`. While it is empty, an Android address is queued for the
  maintainer to add by hand.
- **iPhone testers are added from the maintainer's machine.** `backend/scripts/testers.ts`, run
  by a systemd user timer, takes the iPhone requests from `GET /ops/testers/pending`, adds each
  to the TestFlight group "Prufuflug" through the App Store Connect API, and marks it with
  `POST /ops/testers/:requestId`. The App Store Connect key never reaches the Worker. Marking a
  request posts a fixed reply under the post (a brand string, no model).
- **An address is kept only until it is added.** Marking a request done or failed clears its
  address; the row stays as a count. Deleting the account that asked deletes its requests.
- **The maintainer's sessions use the same seam.** `/ops/mcp` is a stateless MCP server behind
  the maintainer's token, with the tools `list_tester_requests`, `mark_tester_request`,
  `assistant_usage` and `reply_as_assistant`. Stateless, so no Durable Object and no unpinned
  object id exist for it.

## Residency

The text of this one community's posts and comments, with addresses masked, is processed by
Anthropic, outside the EU. That is an exception to the sentence decision 0001 requires the
app to say ("unnin á netkerfi Cloudflare"), and it is limited to this community: the
community's description says that answers in it are automated and where the text goes. No
message, no other community and no profile reaches the model. Nothing is stored outside D1.

## Not done

- **The tester is not notified of an answer** beyond what a comment reply already gives in the
  app. A push for the assistant's answer is left for later.
- **No Durable Object agent and no tool use by the model.** Both would widen what a model
  answer can reach without making the answers better.

## Rules out

- The assistant in any community but the one the var names, or in conversations.
- A model that adds, removes or contacts a tester, or that sees an address.
- The App Store Connect key, or any store credential, in the Worker.
