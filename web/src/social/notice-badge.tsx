import type { ReactNode } from "react";
import type { NoticeBadge } from "../lib/notice-text.ts";

// The mark on the corner of a notification's picture: the reaction's own
// emoji, a speech bubble for a comment or reply, a check for an approved
// request and a shield for a moderator's action (api/presentation.vectors.json).

const SVG = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  className: "size-3",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const GLYPH: Record<Exclude<NoticeBadge, "emoji">, ReactNode> = {
  comment: (
    <svg {...SVG}>
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  approved: (
    <svg {...SVG}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  ),
  friend: (
    <svg {...SVG}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  ),
  moderator: (
    <svg {...SVG}>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    </svg>
  ),
};

/** A reaction without an emoji on the wire falls back to a plain reaction glyph. */
const REACTION_FALLBACK = "👍";

export function NoticeBadgeMark({
  badge,
  emoji,
  pair = false,
}: Readonly<{
  badge: NoticeBadge;
  emoji: string | null;
  /** Two faces fill the diagonal, so the mark takes the free top corner, as on Android. */
  pair?: boolean;
}>) {
  return (
    <span
      aria-hidden="true"
      data-testid="notice-badge"
      className={`absolute ${pair ? "-right-1 -top-1" : "-bottom-1 -right-1"} flex size-5 items-center justify-center rounded-full border border-border bg-surface text-xs text-fg`}
    >
      {badge === "emoji" ? (emoji ?? REACTION_FALLBACK) : GLYPH[badge]}
    </span>
  );
}
