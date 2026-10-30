import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Profile } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { VerifiedMark } from "../ui/kit.tsx";
import { Avatar } from "./avatar.tsx";

// One person in a list on the friends page or a person's screen: the picture,
// the name and its mark lead to their screen, and what can be done sits beside them.

export function FriendRow({
  person,
  detail,
  children,
}: Readonly<{ person: Profile; detail?: string; children?: ReactNode }>) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Link
        to="/people/$accountId"
        params={{ accountId: person.accountId }}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3"
      >
        <Avatar
          kind="person"
          id={person.accountId}
          name={person.name}
          photo={person.photo}
          className="size-10 rounded-md text-sm"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {person.name ?? strings.person_unnamed}
            {person.verified && <VerifiedMark className="ml-2 text-sm" />}
          </span>
          {detail !== undefined && <span className="text-sm text-muted-fg">{detail}</span>}
        </span>
      </Link>
      {children}
    </li>
  );
}
