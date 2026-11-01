import { useState } from "react";
import { strings } from "../generated/brand/strings.ts";
import type { Person } from "../generated/core.d.ts";
import { Avatar } from "../social/avatar.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { readFaces, readFacesLine, shownName } from "./people.ts";

const FACE = "size-5 rounded-full text-[0.6rem] ring-2 ring-surface";

function Face({ person, className }: Readonly<{ person: Person; className: string }>) {
  return (
    <Avatar
      kind="person"
      id={person.account}
      name={person.name}
      photo={person.photo}
      className={className}
    />
  );
}

/** Everyone who has read, by name, so nobody folded into "+N" stays hidden (0125). */
export function ReadByList({ people }: Readonly<{ people: Person[] }>) {
  return (
    <ul className="flex flex-col gap-2">
      {people.map((person) => (
        <li key={person.account} className="flex items-center gap-3">
          <Face person={person} className="size-8 rounded-full text-xs" />
          <span className="min-w-0 break-words">{shownName(person)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Who has read up to a message (0125). A group shows up to four small faces and
 * "+N" on a button that opens everyone by name; a 1:1 keeps the word, since one
 * other person needs no face. The core says who; nothing is worked out here.
 */
export function ReadFaces({ people, group }: Readonly<{ people: Person[]; group: boolean }>) {
  const [open, setOpen] = useState(false);
  if (people.length === 0) return null;
  if (!group) return <span className="text-xs text-muted-fg">{strings.read_marker}</span>;
  const { shown, more } = readFaces(people);
  return (
    <>
      <button
        type="button"
        aria-label={readFacesLine(people)}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1 px-1 text-xs text-muted-fg"
      >
        <span className="flex -space-x-1.5">
          {shown.map((person) => (
            <Face key={person.account} person={person} className={FACE} />
          ))}
        </span>
        {more > 0 && <span aria-hidden="true">{strings.read_by_more({ count: more })}</span>}
      </button>
      {open && (
        <Dialog title={strings.read_by_title} onClose={() => setOpen(false)}>
          <ReadByList people={people} />
        </Dialog>
      )}
    </>
  );
}
