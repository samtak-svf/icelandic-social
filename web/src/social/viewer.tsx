import { useEffect, useRef, useState, type ReactNode } from "react";
import { getPostMedia, type SocialMedia } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { stepBy } from "./viewer-nav.ts";

// The one full-screen viewer a post's images and a comment's image open
// (decision 0082): a native <dialog> shown with showModal(), which makes the
// rest of the page inert and closes on Escape. Focus goes back to what
// opened it.

/** One image to show: where it lives, what it is called. */
export type ViewerItem = { postId: string; media: SocialMedia; alt: string };

// One object URL per image, shared by everything that shows it: the thumbnail
// a post is scrolled in and the viewer that thumbnail opens are one download,
// and scrolling back to an image does not fetch it again. The map is bounded,
// so a long feed cannot hold every image of a community in memory; an entry
// that falls out is the only one whose URL is revoked, and a failed fetch is
// not kept, so the next mount tries again.
const CACHED = 200;
const fetched = new Map<string, Promise<string | null>>();

function mediaUrl(postId: string, mediaId: string): Promise<string | null> {
  const key = `${postId}:${mediaId}`;
  const known = fetched.get(key);
  if (known !== undefined) return known;
  const pending = getPostMedia({ path: { postId, mediaId } })
    .then((answer) => (answer.status === 200 ? URL.createObjectURL(answer.data) : null))
    .catch(() => null)
    .then((url) => {
      if (url === null && fetched.get(key) === pending) fetched.delete(key);
      return url;
    });
  fetched.set(key, pending);
  if (fetched.size > CACHED) {
    const oldest = fetched.keys().next().value;
    if (oldest !== undefined && oldest !== key) {
      const gone = fetched.get(oldest);
      fetched.delete(oldest);
      void gone?.then((url) => {
        if (url !== null) URL.revokeObjectURL(url);
      });
    }
  }
  return pending;
}

/** An image fetched with the client header the API asks of every call, as an object URL. */
export function useMediaSrc(postId: string, mediaId: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    void mediaUrl(postId, mediaId).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [postId, mediaId]);
  return src;
}

const ICON = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Arrow({
  label,
  onClick,
  side,
  children,
}: Readonly<{
  label: string;
  onClick: () => void;
  side: "left-2" | "right-2";
  children: ReactNode;
}>) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`absolute top-1/2 ${side} inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" {...ICON}>
        {children}
      </svg>
    </button>
  );
}

function ViewerImage({ item }: Readonly<{ item: ViewerItem }>) {
  const src = useMediaSrc(item.postId, item.media.mediaId);
  if (src === null) return <div className="size-12 animate-pulse rounded-md bg-white/20" />;
  return <img src={src} alt={item.alt} className="max-h-full max-w-full object-contain" />;
}

/** The viewer itself, open at `start` of `items`; `onClose` runs once it has closed. */
function ImageViewer({
  items,
  start,
  onClose,
}: Readonly<{
  items: readonly ViewerItem[];
  start: number;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(start);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  const item = items[index];
  if (item === undefined) return null;
  return (
    <dialog
      ref={ref}
      aria-label={strings.image_viewer}
      onClose={() => {
        // The `close` event is queued: under React's development double
        // effect it lands after the dialog was shown again, and that is not
        // the person closing it.
        if (ref.current?.open !== true) onClose();
      }}
      onKeyDown={(event) => {
        const next = stepBy(index, items.length, event.key);
        if (next === null) return;
        event.preventDefault();
        setIndex(next);
      }}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-black/90 p-0 text-white backdrop:bg-black"
    >
      <div className="relative flex size-full items-center justify-center p-4">
        <ViewerImage key={item.media.mediaId} item={item} />
        <button
          type="button"
          aria-label={strings.close}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the viewer was opened to look; Escape and this button leave it
          autoFocus
          onClick={() => ref.current?.close()}
          className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full bg-black/60 text-white"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" {...ICON}>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {index > 0 && (
          <Arrow
            label={strings.image_viewer_previous}
            side="left-2"
            onClick={() => setIndex(index - 1)}
          >
            <path d="m15 18-6-6 6-6" />
          </Arrow>
        )}
        {index < items.length - 1 && (
          <Arrow
            label={strings.image_viewer_next}
            side="right-2"
            onClick={() => setIndex(index + 1)}
          >
            <path d="m9 18 6-6-6-6" />
          </Arrow>
        )}
      </div>
    </dialog>
  );
}

/**
 * Opens the viewer from a button: `open(items, at)` remembers the focused
 * element, `viewer` is the node to render, and closing returns focus there.
 */
export function useViewer(): {
  open: (items: readonly ViewerItem[], at: number) => void;
  viewer: ReactNode;
} {
  const [shown, setShown] = useState<{ items: readonly ViewerItem[]; at: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  return {
    open: (items, at) => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setShown({ items, at });
    },
    viewer: shown && (
      <ImageViewer
        items={shown.items}
        start={shown.at}
        onClose={() => {
          setShown(null);
          opener.current?.focus();
          opener.current = null;
        }}
      />
    ),
  };
}
