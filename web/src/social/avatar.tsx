import { strings } from "../generated/brand/strings.ts";

// Initials stand in for a face: each community card and each post or comment
// byline opens with them, sized by the caller. They say nothing only the name
// already beside them says, so they are hidden from the screen reader.

/** The first letter of a name, or of the anonymous stand-in. */
export function initials(name: string | null): string {
  const text = name === null || name.trim() === "" ? strings.person_unnamed : name.trim();
  const first = Array.from(text)[0];
  return first === undefined ? "" : first.toUpperCase();
}

export function Initials({
  name,
  className,
}: Readonly<{ name: string | null; className: string }>) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center bg-primary font-semibold text-primary-fg ${className}`}
    >
      {initials(name)}
    </span>
  );
}
