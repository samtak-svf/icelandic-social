import { useEffect, useState } from "react";
import { call } from "../api/call.ts";
import { useSizeClass, type SizeClass } from "../ui/size-class.ts";

// The one avatar for people and for communities (decision 0080): the photo
// when the API gave a version, otherwise the initials tile of decision 0079.
// It sits beside a name that already says who it is, so it is hidden from the
// screen reader either way.

/**
 * Up to two letters: the first of the first word and of the last, upper-cased
 * (api/presentation.vectors.json, the same rule as the apps). Words are split
 * on spaces only, so a hyphenated name is one word; no name is "?".
 */
export function initials(name: string | null): string {
  const words = (name ?? "").split(" ").filter((word) => word.trim() !== "");
  const first = words[0];
  if (first === undefined) return "?";
  const letters = [first, words.length > 1 ? words.at(-1) : undefined];
  return letters
    .map((word) => (word === undefined ? "" : (Array.from(word)[0] ?? "")))
    .join("")
    .toUpperCase();
}

function Initials({ name, className }: Readonly<{ name: string | null; className: string }>) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center bg-primary font-semibold text-primary-fg ${className}`}
    >
      {initials(name)}
    </span>
  );
}

/** Whose picture it is: a person's account photo or a community's picture. */
export type PictureKind = "person" | "community" | "cover" | "wallCover";

const TEMPLATE = {
  person: "/v1/accounts/{accountId}/photo",
  community: "/v1/communities/{communityId}/avatar",
  cover: "/v1/communities/{communityId}/cover",
  wallCover: "/v1/accounts/{accountId}/wall/cover",
} as const;

// A picture's address changes with its version, so what was fetched for one
// version is good for the page's lifetime. The object URLs are kept for it
// and not revoked: they are 512 px WebP tiles, and every card of one author
// shares one.
const fetched = new Map<string, Promise<string | null>>();

function pictureUrl(
  kind: PictureKind,
  id: string,
  version: string,
  frame?: SizeClass,
): Promise<string | null> {
  const key = `${kind}:${id}:${version}:${frame ?? ""}`;
  let pending = fetched.get(key);
  if (pending === undefined) {
    const path: Record<string, string> =
      kind === "person" || kind === "wallCover" ? { accountId: id } : { communityId: id };
    pending = call<{ status: number; data: unknown }>("GET", TEMPLATE[kind], {
      path,
      query: { v: version, frame },
    })
      .then((answer) =>
        answer.status === 200 && answer.data instanceof Blob
          ? URL.createObjectURL(answer.data)
          : null,
      )
      .catch(() => null);
    fetched.set(key, pending);
  }
  return pending;
}

/**
 * The picture of the person or community `id` at version `photo`, fetched
 * with the client header the API asks of every call (the way a post's images
 * are), or the initials of `name` while there is none or it has not come.
 */
export function Avatar({
  kind,
  id,
  name,
  photo,
  className,
  local,
  alt,
}: Readonly<{
  kind: PictureKind;
  id: string;
  name: string | null;
  /** What the picture is called, when it is not decoration beside the name (the owner's own photo). */
  alt?: string;
  /** The picture's version, as the API gave it; null when there is none to show. */
  photo: string | null;
  className: string;
  /** A picture held in the browser and not yet sent (the create preview, decision 0087); shown in place of any fetched one. */
  local?: string | null;
}>) {
  const [fetchedSrc, setSrc] = useState<string | null>(null);
  const src = local ?? fetchedSrc;
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (photo !== null) {
      void pictureUrl(kind, id, photo).then((url) => {
        if (live) setSrc(url);
      });
    }
    return () => {
      live = false;
    };
  }, [kind, id, photo]);
  if (src === null) return <Initials name={name} className={className} />;
  return (
    <img
      src={src}
      alt={alt ?? ""}
      aria-hidden={alt === undefined ? "true" : undefined}
      className={`shrink-0 bg-muted object-cover ${className}`}
    />
  );
}

/** The cover's box takes the shape of the frame shown, so no frame is cut again by a fixed height. */
const COVER_BOX = "aspect-[3/1] medium:aspect-[4/1] expanded:aspect-[8/3]";

/**
 * A community's cover, or nothing while it has none or has not come. Only
 * the frame of the window's size class is fetched (the API needs the client
 * header, so a <picture> of plain URLs cannot be used); an image with no
 * master serves its one object for every frame, which the box then crops.
 */
export function Cover({
  communityId,
  version,
  className = "",
  local,
  kind = "cover",
}: Readonly<{
  /** The community's id, or with `kind="wallCover"` the account's. */
  communityId: string;
  kind?: "cover" | "wallCover";
  version: string | null;
  className?: string;
  /** A cover held in the browser and not yet sent (the create preview, decision 0087). */
  local?: string | null;
}>) {
  // A cover has one frame per size class (decision 0086), named as the class.
  const frame = useSizeClass();
  const [fetchedSrc, setSrc] = useState<string | null>(null);
  const src = local ?? fetchedSrc;
  useEffect(() => {
    let live = true;
    if (version === null) setSrc(null);
    else {
      void pictureUrl(kind, communityId, version, frame).then((url) => {
        if (live) setSrc(url);
      });
    }
    return () => {
      live = false;
    };
  }, [kind, communityId, version, frame]);
  if (src === null) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={`${COVER_BOX} w-full bg-muted object-cover ${className}`}
    />
  );
}
