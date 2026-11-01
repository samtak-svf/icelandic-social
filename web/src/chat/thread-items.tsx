import { Fragment } from "react";
import type { Item } from "../generated/core.d.ts";
import { ReadFaces } from "./read-faces.tsx";
import { isCard, itemLine, runStarts, shownName } from "./people.ts";

/** A stable key: the seq once stored, else the envelope id, else the place. */
export function itemKey(item: Item, index: number): string {
  return item.seq !== null ? `s${item.seq}` : (item.envelopeId ?? `i${index}`);
}

/**
 * A thread's items, oldest first. A card says what happened to the conversation,
 * between the bubbles. In a group the first bubble of another person's run
 * names them, as on the apps; a 1:1 has only the one other person to name.
 */
export function ThreadItems({ items, group }: Readonly<{ items: Item[]; group: boolean }>) {
  const starts = runStarts(items);
  return (
    <ol className="flex flex-col gap-2">
      {items.map((m, i) => {
        const line = itemLine(m, group);
        if (isCard(m)) {
          return (
            <li key={itemKey(m, i)} className="self-center px-3 text-center text-sm text-muted-fg">
              {line}
            </li>
          );
        }
        return (
          <Fragment key={itemKey(m, i)}>
            <li className={`max-w-[85%] ${m.own ? "self-end" : "self-start"}`}>
              {group && starts[i] && !m.own && (
                <p className="px-1 pb-0.5 text-xs text-muted-fg">{shownName(m.sender)}</p>
              )}
              <div
                className={`whitespace-pre-wrap break-words rounded-md px-3 py-2 ${
                  m.own ? "bg-primary text-primary-fg" : "bg-muted"
                }`}
              >
                {line}
              </div>
            </li>
            {m.readHere.length > 0 && (
              <li className="self-end">
                <ReadFaces people={m.readHere} group={group} />
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
