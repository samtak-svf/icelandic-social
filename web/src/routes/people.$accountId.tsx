import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  acceptFriendRequest,
  blockAccount,
  cancelFriendRequest,
  declineFriendRequest,
  endFriendship,
  getPerson,
  sendFriendRequest,
  snoozePerson,
  unsnoozePerson,
  type Person,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import { Avatar } from "../social/avatar.tsx";
import { FriendRow } from "../social/friend-row.tsx";
import { outcome, useLoad } from "../social/outcome.ts";
import { ReportForm } from "../social/report.tsx";
import { useAct } from "../social/use-act.ts";
import { Button, ProblemText, Status, VerifiedMark } from "../ui/kit.tsx";
import { DotsIcon, Menu, MenuItem } from "../ui/menu.tsx";

// A person's screen (decision 0114), signed-in only. The route has no loader, so
// nothing about the person reaches a page rendered for someone signed out; the
// shell shows the sign-in page there, with the app's own title. The web's core
// exports no `open_direct` (0034), so starting a conversation stands only in the apps.
export const Route = createFileRoute("/people/$accountId")({ component: PersonPage });

function PersonPage() {
  const { accountId } = Route.useParams();
  const [found, reload] = useLoad(
    useCallback(() => outcome(getPerson({ path: { accountId } }), 200), [accountId]),
  );
  if (found === null) return <Status>{strings.loading}</Status>;
  if (!found.ok) {
    return (
      <Status>
        <ProblemText problem={found.problem} />
      </Status>
    );
  }
  return <Screen key={accountId} person={found.data} reload={reload} />;
}

function Screen({ person, reload }: Readonly<{ person: Person; reload: () => void }>) {
  const { accountId } = person;
  const name = person.name ?? strings.person_unnamed;
  const navigate = useNavigate();
  const { busy, problem, act } = useAct(reload);
  const [reporting, setReporting] = useState(false);
  const [told, setTold] = useState<string | null>(null);
  const path = { path: { accountId } };
  const block = () => {
    if (!confirm(strings.block_confirm({ name }))) return;
    void outcome(blockAccount(path), 204).then((result) => {
      if (result.ok) void navigate({ to: "/friends" });
    });
  };
  const other = person.relation !== "self";
  return (
    <>
      <section className="flex flex-col items-center gap-3 text-center">
        <Avatar
          kind="person"
          id={accountId}
          name={person.name}
          photo={person.photo}
          className="size-24 rounded-2xl text-3xl"
        />
        <h1 className="break-words text-2xl font-semibold">
          {name}
          {person.verified && <VerifiedMark className="ml-2 text-base" />}
        </h1>
        <p className="text-muted-fg">
          {strings.person_friend_count({ count: person.friendCount })}
          {other && person.mutualCount > 0 && (
            <> · {strings.person_mutual_count({ count: person.mutualCount })}</>
          )}
        </p>
        {person.friendsSince !== null && (
          <p className="text-sm text-muted-fg">
            {strings.person_friends_since({ date: formatIsDate(person.friendsSince) })}
          </p>
        )}
        {person.snoozedUntil !== null && (
          <p className="text-sm text-muted-fg">
            {strings.person_snoozed_until({ date: formatIsDate(person.snoozedUntil) })}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <RelationActions relation={person.relation} path={path} busy={busy} act={act} />
          {other && (
            <PersonMenu
              person={person}
              act={act}
              block={block}
              report={() => setReporting(true)}
              told={setTold}
            />
          )}
        </div>
        {problem !== null && (
          <Status>
            <ProblemText problem={problem} />
          </Status>
        )}
        {told !== null && <Status>{told}</Status>}
      </section>
      {reporting && (
        <ReportForm
          target={{ kind: "account", id: accountId }}
          onSent={() => {
            setReporting(false);
            setTold(strings.report_sent);
          }}
        />
      )}
      <Shared person={person} />
    </>
  );
}

type Act = ReturnType<typeof useAct>["act"];

/** What can be done about a request or a friendship, by where the two stand. */
function RelationActions({
  relation,
  path,
  busy,
  act,
}: Readonly<{
  relation: Person["relation"];
  path: { path: { accountId: string } };
  busy: boolean;
  act: Act;
}>) {
  return (
    <>
      {relation === "none" && (
        <Button
          tone="primary"
          disabled={busy}
          onClick={() => act(() => outcome(sendFriendRequest(path), 200))}
        >
          {strings.person_add_friend}
        </Button>
      )}
      {relation === "sent" && (
        <>
          <span className="font-medium">{strings.person_request_sent}</span>
          <Button
            disabled={busy}
            onClick={() => act(() => outcome(cancelFriendRequest(path), 204))}
          >
            {strings.person_cancel_request}
          </Button>
        </>
      )}
      {relation === "incoming" && (
        <>
          <span className="font-medium">{strings.person_answer_request}</span>
          <Button
            tone="primary"
            disabled={busy}
            onClick={() => act(() => outcome(acceptFriendRequest(path), 204))}
          >
            {strings.person_accept}
          </Button>
          <Button
            disabled={busy}
            onClick={() => act(() => outcome(declineFriendRequest(path), 204))}
          >
            {strings.person_decline}
          </Button>
        </>
      )}
      {relation === "friends" && <span className="font-medium">{strings.person_friends}</span>}
    </>
  );
}

function PersonMenu({
  person,
  act,
  block,
  report,
  told,
}: Readonly<{
  person: Person;
  act: Act;
  block: () => void;
  report: () => void;
  told: (message: string) => void;
}>) {
  const { accountId } = person;
  const name = person.name ?? strings.person_unnamed;
  const path = { path: { accountId } };
  return (
    <Menu label={strings.notice_menu} icon={<DotsIcon />}>
      {(close) => {
        const run = (then: () => void) => () => {
          close();
          then();
        };
        return (
          <>
            <MenuItem
              onSelect={run(() => {
                void navigator.clipboard
                  .writeText(`${location.origin}/people/${accountId}`)
                  .then(() => told(strings.post_link_copied))
                  .catch(() => undefined);
              })}
            >
              {strings.post_copy_link}
            </MenuItem>
            {person.snoozedUntil === null ? (
              <MenuItem onSelect={run(() => act(() => outcome(snoozePerson(path), 200)))}>
                {strings.person_snooze}
              </MenuItem>
            ) : (
              <MenuItem onSelect={run(() => act(() => outcome(unsnoozePerson(path), 204)))}>
                {strings.person_unsnooze}
              </MenuItem>
            )}
            {person.relation === "friends" && (
              <MenuItem
                onSelect={run(() => {
                  if (confirm(strings.friend_end_confirm({ name }))) {
                    act(() => outcome(endFriendship(path), 204));
                  }
                })}
              >
                {strings.friend_end}
              </MenuItem>
            )}
            <MenuItem onSelect={run(report)}>{strings.report}</MenuItem>
            <MenuItem onSelect={run(block)}>{strings.block}</MenuItem>
          </>
        );
      }}
    </Menu>
  );
}

/** What the two have in common: the communities both are in, and the mutual friends. */
function Shared({ person }: Readonly<{ person: Person }>) {
  return (
    <>
      {person.sharedCommunities.length > 0 && (
        <section className="mt-6 flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{strings.person_shared_communities}</h2>
          <ul className="flex flex-col gap-1">
            {person.sharedCommunities.map((c) => (
              <li key={c.communityId}>
                <Link
                  to="/communities/$communityId"
                  params={{ communityId: c.communityId }}
                  className="flex min-h-11 items-center gap-3"
                >
                  <Avatar
                    kind="community"
                    id={c.communityId}
                    name={c.name}
                    photo={c.photo}
                    className="size-10 rounded-lg"
                  />
                  <span className="min-w-0 truncate font-medium">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {person.mutualFriends.length > 0 && (
        <section className="mt-6 flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{strings.person_mutual_heading}</h2>
          <ul className="flex flex-col gap-1">
            {person.mutualFriends.map((f) => (
              <FriendRow key={f.accountId} person={f} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
