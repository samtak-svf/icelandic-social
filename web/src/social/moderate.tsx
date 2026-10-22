import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useId, useState, type FormEvent } from "react";
import type { Problem } from "../problem.ts";
import {
  communityModerationLog,
  deleteCommunity,
  listCommunityMembers,
  setCommunityRole,
  updateCommunity,
  type Community,
  type CommunityMember,
  type ModerationLogEntry,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Initials } from "./avatar.tsx";
import { outcome, useLoad, when } from "./outcome.ts";
import { Button, ProblemText, Status, VerifiedMark } from "../ui/kit.tsx";

// Stjórna (decision 0079): what a community's owner and moderators reach
// for, in the panel on its page. The reports and the join requests each with
// what waits for them, the details the owner changes (decision 0063), the
// members whose role the owner names, the actions kept (decision 0063), and
// the delete only the owner may do (decision 0070).

/** The actions on a community that are kept, told with the words the queue uses. */
const LOGGED: Record<ModerationLogEntry["action"], string> = {
  hide_post: strings.moderation_decision_hide_post,
  remove_post: strings.moderation_decision_remove_post,
  restore_post: strings.moderation_decision_restore_post,
  hide_comment: strings.moderation_decision_hide_comment,
  remove_comment: strings.moderation_decision_remove_comment,
  restore_comment: strings.moderation_decision_restore_comment,
  mute_member: strings.moderation_decision_mute_member,
  unmute_member: strings.moderation_decision_unmute_member,
  remove_member: strings.moderation_decision_remove_member,
  ban_member: strings.moderation_decision_ban_member,
  unban_member: strings.moderation_decision_unban_member,
  close_report: strings.moderation_decision_dismissed,
  delete_community: strings.moderation_decision_community_deleted,
  restore_community: strings.community_restore,
  set_community_picture: strings.moderation_log_community_picture_set,
  remove_community_picture: strings.moderation_log_community_picture_removed,
  set_community_cover: strings.moderation_log_community_cover_set,
  remove_community_cover: strings.moderation_log_community_cover_removed,
  pin_post: strings.moderation_log_post_pinned,
  unpin_post: strings.moderation_log_post_unpinned,
};

/** The moderator's and the owner's tools, with the number waiting for them. */
export function Manage({
  community,
  changed,
}: Readonly<{ community: Community; changed: () => void }>) {
  const { communityId } = community;
  const waiting = (community.openReports ?? 0) + (community.pendingJoinRequests ?? 0);
  const owner = community.role === "owner";
  return (
    <details open className="mt-6 rounded-md border border-border p-3">
      <summary className="cursor-pointer text-lg font-semibold">
        {waiting > 0
          ? strings.community_manage_count({ count: waiting })
          : strings.community_manage}
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        <nav className="flex flex-wrap gap-x-6">
          <Link
            to="/communities/$communityId/reports"
            params={{ communityId }}
            className="inline-flex min-h-11 items-center underline"
          >
            {strings.moderation_queue}
            {(community.openReports ?? 0) > 0 && (
              <span className="ml-2 rounded-full bg-primary px-2 text-sm text-primary-fg">
                {community.openReports}
              </span>
            )}
          </Link>
          <Link
            to="/communities/$communityId/requests"
            params={{ communityId }}
            className="inline-flex min-h-11 items-center underline"
          >
            {community.pendingJoinRequests !== null && community.pendingJoinRequests > 0
              ? strings.join_requests_waiting({ count: community.pendingJoinRequests })
              : strings.join_requests_title}
          </Link>
        </nav>
        {owner && <Edit community={community} changed={changed} />}
        {owner && <Roles community={community} changed={changed} />}
        <Log communityId={communityId} />
        {owner && <Delete community={community} />}
      </div>
    </details>
  );
}

/** Breyta samfélagi: the owner changes its name, description or audience (decision 0063). */
function Edit({ community, changed }: Readonly<{ community: Community; changed: () => void }>) {
  const id = useId();
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description);
  const [audience, setAudience] = useState<"open" | "private">(community.audience);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      updateCommunity({
        path: { communityId: community.communityId },
        body: { name: name.trim(), description: description.trim(), audience },
      }),
      200,
    );
    setBusy(false);
    if (done.ok) changed();
    else setProblem(done.problem);
  }

  const field = "min-h-11 rounded-md border border-border-strong bg-surface px-3";
  return (
    <details>
      <summary className="cursor-pointer text-base font-semibold">{strings.community_edit}</summary>
      <form onSubmit={(event) => void submit(event)} className="mt-2 flex flex-col gap-2">
        <label htmlFor={`${id}-name`}>{strings.community_name}</label>
        <input
          id={`${id}-name`}
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={field}
        />
        <label htmlFor={`${id}-description`}>{strings.community_description}</label>
        <textarea
          id={`${id}-description`}
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={`${field} py-2`}
        />
        <fieldset className="flex flex-col">
          {(["open", "private"] as const).map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === value}
                // A private community never becomes open: its members joined on that promise.
                disabled={value === "open" && community.audience === "private"}
                onChange={() => setAudience(value)}
              />
              <span className="font-semibold">
                {value === "open" ? strings.community_open : strings.community_private}
              </span>
            </label>
          ))}
        </fieldset>
        <Button tone="primary" type="submit" disabled={busy || name.trim() === ""}>
          {strings.community_edit}
        </Button>
        <Status>{problem && <ProblemText problem={problem} />}</Status>
      </form>
    </details>
  );
}

/** The members whose role the owner names (decision 0063), and each one as it is. */
function Roles({ community, changed }: Readonly<{ community: Community; changed: () => void }>) {
  const [members, reload] = useLoad(
    useCallback(
      () => outcome(listCommunityMembers({ path: { communityId: community.communityId } }), 200),
      [community.communityId],
    ),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function setRole(member: CommunityMember, role: "moderator" | "member") {
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      setCommunityRole({
        path: { communityId: community.communityId, accountId: member.accountId },
        body: { role },
      }),
      204,
    );
    setBusy(false);
    if (done.ok) {
      reload();
      changed();
    } else setProblem(done.problem);
  }

  return (
    <section aria-label={strings.community_members_title} className="flex flex-col gap-2">
      <h3 className="font-semibold">{strings.community_members_title}</h3>
      {members === null && <Status>{strings.loading}</Status>}
      {members?.ok === false && (
        <Status>
          <ProblemText problem={members.problem} />
        </Status>
      )}
      {members?.ok && (
        <ul className="flex flex-col gap-2">
          {members.data.members.map((member) => (
            <li key={member.accountId} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <Initials name={member.name} className="size-8 rounded-md text-sm" />
                <span className="font-semibold">{member.name ?? strings.person_unnamed}</span>
                {member.verified && <VerifiedMark className="text-sm" />}
                {member.role === "moderator" && (
                  <span className="text-sm text-muted-fg">{strings.community_role_moderator}</span>
                )}
              </span>
              {member.role === "member" && (
                <Button disabled={busy} onClick={() => void setRole(member, "moderator")}>
                  {strings.community_make_moderator}
                </Button>
              )}
              {member.role === "moderator" && (
                <Button disabled={busy} onClick={() => void setRole(member, "member")}>
                  {strings.community_remove_moderator}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </section>
  );
}

/** The log, newest first (decision 0063), kept a year (decision 0070). */
function Log({ communityId }: Readonly<{ communityId: string }>) {
  const [log] = useLoad(
    useCallback(
      () => outcome(communityModerationLog({ path: { communityId } }), 200),
      [communityId],
    ),
  );
  return (
    <section aria-label={strings.moderation_log_title} className="flex flex-col gap-2">
      <h3 className="font-semibold">{strings.moderation_log_title}</h3>
      {log === null && <Status>{strings.loading}</Status>}
      {log?.ok === false && (
        <Status>
          <ProblemText problem={log.problem} />
        </Status>
      )}
      {log?.ok && log.data.entries.length === 0 && (
        <p className="text-muted-fg">{strings.moderation_log_empty}</p>
      )}
      {log?.ok && (
        <ul className="flex flex-col gap-2">
          {log.data.entries.map((entry) => (
            <li key={entry.entryId} className="flex flex-col gap-1 rounded-md bg-muted p-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{LOGGED[entry.action]}</span>
                <time
                  dateTime={new Date(entry.createdAt).toISOString()}
                  className="text-sm text-muted-fg"
                >
                  {when(entry.createdAt)}
                </time>
              </div>
              {entry.actor !== null && (
                <p className="text-sm text-muted-fg">
                  {entry.actor.name ?? strings.person_unnamed}
                </p>
              )}
              {entry.reason !== "" && <p className="whitespace-pre-wrap">{entry.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The owner deletes the community, once they confirm what goes with it (#364). */
function Delete({ community }: Readonly<{ community: Community }>) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  async function remove() {
    if (!confirm(strings.community_delete_confirm({ name: community.name }))) return;
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      deleteCommunity({ path: { communityId: community.communityId } }),
      204,
    );
    setBusy(false);
    if (done.ok) await navigate({ to: "/communities" });
    else setProblem(done.problem);
  }
  return (
    <section className="flex flex-col items-start gap-2 border-t border-border pt-4">
      <Button tone="danger" disabled={busy} onClick={() => void remove()}>
        {strings.community_delete}
      </Button>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </section>
  );
}
