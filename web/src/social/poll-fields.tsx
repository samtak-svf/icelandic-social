import { strings } from "../generated/brand/strings.ts";
import { Button } from "../ui/kit.tsx";
import { POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, POLL_OPTION_MAX } from "./poll-draft.ts";

/** The option fields of a poll being written (decision 0090): two to six, each its own line. */
export function PollFields({
  options,
  busy,
  change,
}: Readonly<{ options: string[]; busy: boolean; change: (options: string[]) => void }>) {
  return (
    <fieldset className="flex flex-col gap-2">
      {options.map((option, at) => (
        <div key={at} className="flex items-center gap-2">
          <input
            type="text"
            value={option}
            maxLength={POLL_OPTION_MAX}
            aria-label={strings.composer_poll_option({ n: at + 1 })}
            placeholder={strings.composer_poll_option({ n: at + 1 })}
            disabled={busy}
            onChange={(event) =>
              change(options.map((value, i) => (i === at ? event.target.value : value)))
            }
            className="min-h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2"
          />
          {options.length > POLL_MIN_OPTIONS && (
            <Button
              className="text-sm"
              disabled={busy}
              onClick={() => change(options.filter((_, i) => i !== at))}
            >
              {strings.composer_poll_remove_option}
            </Button>
          )}
        </div>
      ))}
      {options.length < POLL_MAX_OPTIONS && (
        <Button
          className="self-start text-sm"
          disabled={busy}
          onClick={() => change([...options, ""])}
        >
          {strings.composer_poll_add_option}
        </Button>
      )}
    </fieldset>
  );
}
