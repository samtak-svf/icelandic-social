import { Link } from "@tanstack/react-router";
import type { Author } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { VerifiedMark } from "../ui/kit.tsx";

export function authorName(author: Author | null): string {
  if (author === null) return strings.person_deleted;
  return author.name ?? strings.person_unnamed;
}

/** The name split before its last word, which the mark is held to. */
export function lastWord(name: string): readonly [string, string] {
  const cut = name.trimEnd().lastIndexOf(" ") + 1;
  return [name.slice(0, cut), name.slice(cut)];
}

/** The author's name, with the verified mark when Kenni vouches for them (#358). */
export function AuthorName({ author }: Readonly<{ author: Author | null }>) {
  const name = authorName(author);
  if (author?.verified !== true) {
    return <span className="min-w-0 break-words font-semibold">{name}</span>;
  }
  const [head, last] = lastWord(name);
  return (
    // The mark is part of the name's own line: its last word and the mark never break apart,
    // so a name that wraps keeps the mark after it instead of at the far edge of the row. A
    // word joiner does not do this: Chrome breaks before an inline-flex box regardless.
    <span className="min-w-0 break-words font-semibold">
      {head}
      <span className="whitespace-nowrap">
        {last}
        <VerifiedMark className="ml-2 text-sm" />
      </span>
    </span>
  );
}

/** A name that leads to the person's screen; a removed author has no screen to lead to. */
export function PersonName({ author }: Readonly<{ author: Author | null }>) {
  if (author === null) return <AuthorName author={author} />;
  return (
    <Link
      to="/people/$accountId"
      params={{ accountId: author.accountId }}
      className="min-w-0 hover:underline"
    >
      <AuthorName author={author} />
    </Link>
  );
}
