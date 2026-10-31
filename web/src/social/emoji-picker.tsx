import { strings } from "../generated/brand/strings.ts";

/** The six reactions of the quick bar, in order (decision 0100). */
export const QUICK = [
  { emoji: "👍", label: strings.reaction_like },
  { emoji: "❤️", label: strings.reaction_love },
  { emoji: "😂", label: strings.reaction_laugh },
  { emoji: "😮", label: strings.reaction_wow },
  { emoji: "😢", label: strings.reaction_sad },
  { emoji: "🙏", label: strings.reaction_pray },
] as const;

// A browser has no emoji picker of its own, so this is a fixed grid of the commonly used ones.
// The server accepts any single emoji, so a reaction set from an app may be outside it.
const GROUPS = [
  "😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😗😋😛😜🤪😝🤗🤭🤔🤨😐😑😶🙄😏😣😥😮😯😪😫🥱😴😌😎🤓😕😟🙁😲😳🥺😦😧😨😰😢😭😱😖😞😓😩😠😡🤬🤯😷🤒🤕🤢🤮🥵🥶😵🥴",
  "👍👎👏🙌👐🤝🙏💪👌✌️🤞🤟🤘👋🤙👀🔥✨🎉🎊💯💔❤️🧡💛💚💙💜🖤🤍💖💕✅❌⭐🌈☀️🌹🌱🍀🎶🏆🚀",
];
const segmenter = new Intl.Segmenter();
const ALL = GROUPS.flatMap((group) => Array.from(segmenter.segment(group), (g) => g.segment));

/** A grid of emoji to pick one from; the one already chosen is marked. */
export function EmojiPicker({
  chosen,
  onPick,
}: Readonly<{ chosen: string | null; onPick: (emoji: string) => void }>) {
  return (
    <div
      role="group"
      aria-label={strings.post_reactions_all}
      className="grid max-h-56 w-72 grid-cols-8 gap-0.5 overflow-y-auto p-1"
    >
      {ALL.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={emoji}
          aria-pressed={chosen === emoji}
          onClick={() => onPick(emoji)}
          className="inline-flex size-9 items-center justify-center rounded-md text-xl hover:bg-muted aria-pressed:bg-muted"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
