import type { ReactNode } from "react";
import { strings } from "../generated/brand/strings.ts";

// What a list shows while it loads: grey shapes the size of what is coming,
// so the page does not jump when it arrives, and a status line read out to
// assistive technology instead of a visible "Hleður…". The part that loads
// carries `aria-busy` while it does.

const BLOCK = "rounded-md bg-muted motion-safe:animate-pulse";

/** The announced status and the placeholders drawn in its place. */
export function Loading({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <p role="status" className="sr-only">
        {strings.loading}
      </p>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </>
  );
}

/** `count` rows the shape of a community row: a picture and two lines. */
export function RowPlaceholders({ count = 3 }: Readonly<{ count?: number }>) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="flex min-h-14 items-center gap-3 rounded-md border border-border px-4 py-2"
        >
          <span className={`size-10 shrink-0 ${BLOCK}`} />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className={`h-4 w-2/3 ${BLOCK}`} />
            <span className={`h-3 w-1/3 ${BLOCK}`} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** `count` cards the shape of a post: a byline, a few lines of text and the actions. */
export function CardPlaceholders({ count = 2 }: Readonly<{ count?: number }>) {
  return (
    <ul className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex flex-col gap-3 rounded-md border border-border p-4">
          <span className="flex items-center gap-3">
            <span className={`size-10 shrink-0 rounded-full ${BLOCK}`} />
            <span className={`h-4 w-1/3 ${BLOCK}`} />
          </span>
          <span className={`h-4 w-full ${BLOCK}`} />
          <span className={`h-4 w-5/6 ${BLOCK}`} />
          <span className={`h-4 w-1/2 ${BLOCK}`} />
          <span className={`mt-2 h-11 w-full ${BLOCK}`} />
        </li>
      ))}
    </ul>
  );
}
