import { Link } from "@tanstack/react-router";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  endFriendship,
  sendFriendRequest,
  snoozePerson,
  unsnoozePerson,
  type Person,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Button } from "../ui/kit.tsx";
import { DotsIcon, Menu, MenuItem } from "../ui/menu.tsx";
import { Avatar } from "./avatar.tsx";
import { FriendRow } from "./friend-row.tsx";
import { outcome } from "./outcome.ts";
import type { useAct } from "./use-act.ts";

// The parts of a person's screen that are about the relation between two
// accounts (decision 0114): what can be done about a request or a friendship,
// the menu, and what the two have in common. The wall (decision 0115) shows them.

export type Act = ReturnType<typeof useAct>["act"];

/** What can be done about a request or a friendship, by where the two stand. */
export function RelationActions({
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

export function PersonMenu({
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
export function Shared({ person }: Readonly<{ person: Person }>) {
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
