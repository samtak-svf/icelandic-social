import { useCallback, useId, useState } from "react";
import {
  notificationSettings,
  putNotificationSettings,
  setCommunityNotificationLevel,
  type NotificationLevel,
  type NotificationSettings,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { ProblemText, Status } from "../ui/kit.tsx";
import { outcome, useLoad } from "./outcome.ts";
import type { Problem } from "../problem.ts";

// How loudly the reader is told (decision 0106): one level per kind of
// notification and one per community; the lower of the two applies. A
// moderator's action is never lower than in_app.

export type Kind = keyof NotificationSettings["kinds"];

export const KINDS: readonly Kind[] = [
  "comment",
  "reply",
  "reaction",
  "join_approved",
  "moderated",
];

const ALL_LEVELS: readonly NotificationLevel[] = ["push", "in_app", "off"];

const LEVEL_TEXT: Record<NotificationLevel, string> = {
  push: strings.notification_level_push,
  in_app: strings.notification_level_in_app,
  off: strings.notification_level_off,
};

export const KIND_TEXT: Record<Kind, string> = {
  comment: strings.notification_kind_comment,
  reply: strings.notification_kind_reply,
  reaction: strings.notification_kind_reaction,
  join_approved: strings.notification_kind_join_approved,
  moderated: strings.notification_kind_moderated,
};

/** The levels a kind may be set to, loudest first. */
export function levelsFor(kind: Kind): NotificationLevel[] {
  return kind === "moderated" ? ["push", "in_app"] : ["push", "in_app", "off"];
}

/** The level a select's value names; `fallback` for anything else. */
function levelOf(value: string, fallback: NotificationLevel): NotificationLevel {
  return ALL_LEVELS.find((level) => level === value) ?? fallback;
}

export function LevelSelect({
  label,
  value,
  levels,
  disabled = false,
  onChange,
}: Readonly<{
  label: string;
  value: NotificationLevel;
  levels: readonly NotificationLevel[];
  disabled?: boolean;
  onChange: (level: NotificationLevel) => void;
}>) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(levelOf(event.target.value, value))}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-2"
      >
        {levels.map((level) => (
          <option key={level} value={level}>
            {LEVEL_TEXT[level]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The stored settings, and a way to change a kind or a community, each saved at once. */
export function useLevels() {
  const [loaded, reload] = useLoad(useCallback(() => outcome(notificationSettings(), 200), []));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (act: () => Promise<{ ok: boolean; problem?: Problem }>) => {
    setBusy(true);
    setProblem(null);
    const done = await act();
    setBusy(false);
    if (done.ok) reload();
    else setProblem(done.problem ?? { kind: "unreachable" });
  };
  const setKind = (kind: Kind, level: NotificationLevel) =>
    save(() => outcome(putNotificationSettings({ body: { kinds: { [kind]: level } } }), 204));
  const setCommunity = (communityId: string, level: NotificationLevel) =>
    save(() =>
      outcome(setCommunityNotificationLevel({ path: { communityId }, body: { level } }), 204),
    );
  return {
    settings: loaded?.ok ? loaded.data : null,
    loaded,
    problem,
    busy,
    setKind,
    setCommunity,
  };
}

/** The level picker of one community, on its Um tab. */
export function CommunityLevel({ communityId }: Readonly<{ communityId: string }>) {
  const { settings, loaded, problem, busy, setCommunity } = useLevels();
  const value = settings?.communities.find((c) => c.communityId === communityId)?.level ?? "push";
  return (
    <>
      <LevelSelect
        label={strings.notification_settings_title}
        value={value}
        levels={levelsFor("comment")}
        disabled={busy || settings === null}
        onChange={(level) => void setCommunity(communityId, level)}
      />
      <Status>
        {loaded?.ok === false && <ProblemText problem={loaded.problem} />}
        {problem !== null && <ProblemText problem={problem} />}
      </Status>
    </>
  );
}
