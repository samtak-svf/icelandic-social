import { useCallback, useState } from "react";
import { friendSuggestionSettings, putFriendSuggestionSettings } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { ProblemText, Status } from "../ui/kit.tsx";
import { outcome, useLoad } from "./outcome.ts";

// Settings, Tillögur (decision 0114): one switch that works both ways.
export function SuggestionSettingsSection() {
  const [loaded, reload] = useLoad(useCallback(() => outcome(friendSuggestionSettings(), 200), []));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const set = async (included: boolean) => {
    setBusy(true);
    setProblem(null);
    const result = await outcome(putFriendSuggestionSettings({ body: { included } }), 204);
    setBusy(false);
    if (result.ok) reload();
    else setProblem(result.problem);
  };
  return (
    <section aria-labelledby="suggestion-settings" className="mt-6">
      <h2 id="suggestion-settings" className="text-xl font-semibold">
        {strings.suggestions_setting_title}
      </h2>
      {loaded === null && <Status>{strings.loading}</Status>}
      {loaded !== null && !loaded.ok && (
        <Status>
          <ProblemText problem={loaded.problem} />
        </Status>
      )}
      {loaded?.ok === true && (
        <label className="mt-4 flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            checked={loaded.data.included}
            disabled={busy}
            onChange={(event) => void set(event.target.checked)}
          />
          <span className="flex flex-col">
            <span className="font-semibold">{strings.suggestions_setting_label}</span>
            <span className="text-sm text-muted-fg">{strings.suggestions_setting_hint}</span>
          </span>
        </label>
      )}
      <Status>{problem !== null && <ProblemText problem={problem} />}</Status>
    </section>
  );
}
