import { useState } from "react";
import { joinCommunity, withdrawJoinRequest, type Community } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import type { Problem } from "../problem.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { endsNotice } from "./ends-notice.ts";
import { outcome, type Outcome } from "./outcome.ts";
import { useSuspended } from "./suspended.tsx";

// What the caller can do about belonging to a community (decisions 0063, 0070,
// 0130): join it, ask to, take the request back, or answer an invitation.

/** Who invited the caller, and the two ways to answer. */
export function InvitedAnswer({
  by,
  busy,
  suspended,
  accept,
  decline,
}: Readonly<{
  by: Community["invitedBy"];
  busy: boolean;
  suspended: boolean;
  accept: () => void;
  decline: () => void;
}>) {
  return (
    <>
      <p>
        {by === null
          ? strings.community_invited
          : strings.community_invited_by({ name: by.name ?? strings.person_deleted })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button tone="primary" disabled={busy || suspended} onClick={accept}>
          {strings.community_accept_invite}
        </Button>
        <Button disabled={busy} onClick={decline}>
          {strings.community_decline_invite}
        </Button>
      </div>
    </>
  );
}

export function Membership({
  community,
  changed,
}: Readonly<{ community: Community; changed: () => void }>) {
  const suspended = useSuspended();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const path = { communityId: community.communityId };

  async function change(pending: Promise<Outcome<unknown>>) {
    setBusy(true);
    setProblem(null);
    const done = await pending;
    setBusy(false);
    if (done.ok) changed();
    else if (done.problem) setProblem(done.problem);
  }

  const declinedUntil = community.joinDeclinedUntil;
  let control = null;
  if (community.invited && community.role === null) {
    // An invitation stands (decision 0130): answered, never asked for again.
    control = (
      <InvitedAnswer
        by={community.invitedBy}
        busy={busy}
        suspended={suspended}
        accept={() => void change(endsNotice(outcome(joinCommunity({ path }), 200)))}
        decline={() => void change(endsNotice(outcome(withdrawJoinRequest({ path }), 204)))}
      />
    );
  } else if (declinedUntil !== null && declinedUntil > Date.now()) {
    control = (
      <>
        <p>{strings.community_join_declined}</p>
        <p className="text-sm text-muted-fg">
          {strings.community_join_again({ date: formatIsDate(declinedUntil) })}
        </p>
      </>
    );
  } else if (community.joinRequested) {
    control = (
      <>
        <p>{strings.community_join_requested}</p>
        <Button
          disabled={busy}
          onClick={() => void change(endsNotice(outcome(withdrawJoinRequest({ path }), 204)))}
        >
          {strings.community_withdraw_request}
        </Button>
      </>
    );
  } else if (community.role === null) {
    const label =
      community.audience === "open" ? strings.community_join : strings.community_request_join;
    control = (
      <Button
        tone="primary"
        disabled={busy || suspended}
        onClick={() => void change(endsNotice(outcome(joinCommunity({ path }), 200)))}
      >
        {label}
      </Button>
    );
  }
  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      {control}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </div>
  );
}
