import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  approveJoinRequest,
  declineJoinRequest,
  listJoinRequests,
  type JoinRequest,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { ManageFrame } from "../social/manage-frame.tsx";
import { outcome, useLoad, when, type Outcome } from "../social/outcome.ts";
import { AuthorName } from "../social/post.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// The join requests that wait in a private community (#354), oldest first. A
// moderator approves one, and the account becomes a member, or declines it,
// and the account may ask again after 30 days (decision 0070).
export const Route = createFileRoute("/communities/$communityId/requests")({
  component: RequestsPage,
  staticData: { width: "wide" },
});

function RequestsPage() {
  const { communityId } = Route.useParams();
  return (
    <ManageFrame communityId={communityId}>
      {(_, changed) => <Requests communityId={communityId} changed={changed} />}
    </ManageFrame>
  );
}

function Requests({
  communityId,
  changed,
}: Readonly<{ communityId: string; changed: () => void }>) {
  const [requests, reload] = useLoad(
    useCallback(() => outcome(listJoinRequests({ path: { communityId } }), 200), [communityId]),
  );
  const answered = useCallback(() => {
    reload();
    changed();
  }, [reload, changed]);
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.join_requests_title}</h1>
      {requests === null && <Status>{strings.loading}</Status>}
      {requests?.ok === false && (
        <Status>
          <ProblemText problem={requests.problem} />
        </Status>
      )}
      {requests?.ok && requests.data.requests.length === 0 && (
        <p className="mt-4 text-muted-fg">{strings.join_requests_empty}</p>
      )}
      {requests?.ok && requests.data.requests.length > 0 && (
        <ul className="mt-4 flex flex-col gap-4">
          {requests.data.requests.map((r) => (
            <li key={r.accountId}>
              <RequestItem request={r} communityId={communityId} answered={answered} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RequestItem({
  request,
  communityId,
  answered,
}: Readonly<{ request: JoinRequest; communityId: string; answered: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const path = { communityId, accountId: request.accountId };
  async function answer(pending: Promise<Outcome<unknown>>) {
    setBusy(true);
    setProblem(null);
    const done = await pending;
    setBusy(false);
    if (done.ok) answered();
    else setProblem(done.problem);
  }
  const author = {
    accountId: request.accountId,
    name: request.name,
    verified: request.verified,
    photo: null,
    role: null,
  };
  return (
    <article className="flex flex-col gap-2 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <AuthorName author={author} />
        <time
          dateTime={new Date(request.requestedAt).toISOString()}
          className="text-sm text-muted-fg"
        >
          {when(request.requestedAt)}
        </time>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button
          tone="primary"
          disabled={busy}
          onClick={() => void answer(outcome(approveJoinRequest({ path }), 204))}
        >
          {strings.join_request_approve}
        </Button>
        <Button
          tone="danger"
          disabled={busy}
          onClick={() => void answer(outcome(declineJoinRequest({ path }), 204))}
        >
          {strings.join_request_decline}
        </Button>
      </div>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </article>
  );
}
