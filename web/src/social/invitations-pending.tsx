import { useCallback, useState } from "react";
import { listInvitations, withdrawInvitation, type CommunityInvitation } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { ProblemText, Button, Status } from "../ui/kit.tsx";
import { AuthorName } from "./author-name.tsx";
import { outcome, useLoad, when } from "./outcome.ts";

// The invitations that wait in a community (decision 0130): the moderator sees
// whom they went to and who sent them, and can take one back. Nothing is drawn
// when none waits.

export function InvitationsPending({ communityId }: Readonly<{ communityId: string }>) {
  const [list, reload] = useLoad(
    useCallback(() => outcome(listInvitations({ path: { communityId } }), 200), [communityId]),
  );
  if (list === null || !list.ok || list.data.invitations.length === 0) return null;
  return (
    <section aria-labelledby="invitations-pending" className="mt-8">
      <h2 id="invitations-pending" className="font-headline text-2xl">
        {strings.community_invitations_pending}
      </h2>
      <ul className="mt-4 flex flex-col gap-4">
        {list.data.invitations.map((i) => (
          <li key={i.accountId}>
            <InvitationItem invitation={i} communityId={communityId} withdrawn={reload} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function InvitationItem({
  invitation,
  communityId,
  withdrawn,
}: Readonly<{ invitation: CommunityInvitation; communityId: string; withdrawn: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  async function withdraw() {
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      withdrawInvitation({ path: { communityId, accountId: invitation.accountId } }),
      204,
    );
    setBusy(false);
    if (done.ok) withdrawn();
    else setProblem(done.problem);
  }
  return (
    <InvitationView
      invitation={invitation}
      busy={busy}
      problem={problem}
      withdraw={() => void withdraw()}
    />
  );
}

/** One waiting invitation: whom it went to, who sent it, and the way to take it back. */
export function InvitationView({
  invitation,
  busy,
  problem,
  withdraw,
}: Readonly<{
  invitation: CommunityInvitation;
  busy: boolean;
  problem: Problem | null;
  withdraw: () => void;
}>) {
  const invited = {
    accountId: invitation.accountId,
    name: invitation.name,
    verified: false,
    photo: null,
    role: null,
  };
  return (
    <article className="flex flex-col gap-2 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <AuthorName author={invited} />
        <time
          dateTime={new Date(invitation.createdAt).toISOString()}
          className="text-sm text-muted-fg"
        >
          {when(invitation.createdAt)}
        </time>
      </header>
      {invitation.invitedBy !== null && (
        <p className="text-sm text-muted-fg">
          {strings.community_invitation_from({
            name: invitation.invitedBy.name ?? strings.person_deleted,
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button tone="danger" disabled={busy} onClick={withdraw}>
          {strings.community_withdraw_invite}
        </Button>
      </div>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </article>
  );
}
