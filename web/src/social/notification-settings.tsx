import { useCallback } from "react";
import { myCommunities } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { ProblemText, Status } from "../ui/kit.tsx";
import { KIND_TEXT, KINDS, LevelSelect, levelsFor, useLevels } from "./notification-level.tsx";
import { outcome, useLoad } from "./outcome.ts";

// Settings, Tilkynningar (decision 0106): a level for each kind, then for each
// community that has one stored. A community the reader has left has no name
// to show and is left out.
export function NotificationSettingsSection() {
  const { settings, loaded, problem, busy, setKind, setCommunity } = useLevels();
  const [mine] = useLoad(useCallback(() => outcome(myCommunities(), 200), []));
  const names = new Map(
    (mine?.ok ? mine.data.communities : []).map((c) => [c.communityId, c.name]),
  );
  const stored = (settings?.communities ?? []).filter((c) => names.has(c.communityId));
  return (
    <section aria-labelledby="notification-settings" className="mt-6">
      <h2 id="notification-settings" className="text-xl font-semibold">
        {strings.notification_settings_title}
      </h2>
      <p className="text-sm text-muted-fg">{strings.notification_settings_body}</p>
      {settings === null ? (
        <Status>
          {loaded === null ? (
            strings.loading
          ) : (
            <ProblemText problem={loaded.ok ? { kind: "unreachable" } : loaded.problem} />
          )}
        </Status>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2 rounded-md border border-border p-4">
            {KINDS.map((kind) => (
              <LevelSelect
                key={kind}
                label={KIND_TEXT[kind]}
                value={settings.kinds[kind]}
                levels={levelsFor(kind)}
                disabled={busy}
                onChange={(level) => void setKind(kind, level)}
              />
            ))}
            <p className="text-sm text-muted-fg">{strings.notification_moderated_floor}</p>
          </div>
          {stored.length > 0 && (
            <>
              <h3 className="mt-6 text-lg font-semibold">
                {strings.notification_settings_communities}
              </h3>
              <div className="mt-2 flex flex-col gap-2 rounded-md border border-border p-4">
                {stored.map((c) => (
                  <LevelSelect
                    key={c.communityId}
                    label={names.get(c.communityId) ?? ""}
                    value={c.level}
                    levels={levelsFor("comment")}
                    disabled={busy}
                    onChange={(level) => void setCommunity(c.communityId, level)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
      <Status>{problem !== null && <ProblemText problem={problem} />}</Status>
    </section>
  );
}
