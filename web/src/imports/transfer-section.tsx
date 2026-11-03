import { Link } from "@tanstack/react-router";
import { useId } from "react";
import {
  listTransfers,
  revokeTransfer,
  type TransferGrant,
  type TransferScope,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { outcome, useLoad, when } from "../social/outcome.ts";
import { Button, Status } from "../ui/kit.tsx";
import { ImportProblem, useAct } from "./shared.tsx";

// What exporters the person allowed to transfer in directly (decision 0129): since when,
// what came in, what waits for them, and taking the grant back. The grant is given on the
// consent screen the exporter sends them to, never from here.

export const SCOPE_WORD: Readonly<Record<TransferScope, string>> = {
  "social-posts": strings.transfer_scope_social,
  media: strings.transfer_scope_media,
};

/** One grant, with its counts and what can be done with it. */
export function TransferRow({
  grant,
  revoke,
  disabled = false,
}: Readonly<{ grant: TransferGrant; revoke: () => void; disabled?: boolean }>) {
  return (
    <li className="flex flex-col gap-2 p-3">
      <p className="font-medium">{grant.clientName}</p>
      <p className="text-sm text-muted-fg">
        {strings.transfer_since({ date: when(grant.createdAt) })}
        {grant.lastItemAt !== null && ` ${strings.transfer_last({ date: when(grant.lastItemAt) })}`}
      </p>
      <p className="text-sm">
        {strings.imports_sync_posts({ count: grant.posts })}
        {grant.held > 0 && ` ${strings.transfer_held({ count: grant.held })}`}
      </p>
      {grant.leftBehind > 0 && (
        <p className="text-sm text-muted-fg">
          {strings.transfer_left_behind({ count: grant.leftBehind })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {grant.importId !== null && grant.held > 0 && (
          <Link to="/imports/$importId" params={{ importId: grant.importId }} className="underline">
            {strings.imports_preview_link}
          </Link>
        )}
        <Button tone="danger" onClick={revoke} disabled={disabled}>
          {strings.transfer_revoke}
        </Button>
      </div>
    </li>
  );
}

const loadTransfers = () => outcome(listTransfers(), 200);

export function TransferSection() {
  const title = useId();
  const [list, reload] = useLoad(loadTransfers);
  const { busy, problem, act } = useAct(reload);

  if (list === null) return null;
  if (!list.ok) {
    return (
      <Status>
        <ImportProblem problem={list.problem} />
      </Status>
    );
  }
  const { available, grants } = list.data;
  if (!available && grants.length === 0) return null;
  return (
    <section aria-labelledby={title} className="mt-8">
      <h2 id={title} className="text-xl font-semibold">
        {strings.transfer_title}
      </h2>
      <p className="mt-1 text-sm text-muted-fg">{strings.transfer_hint}</p>
      {grants.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border">
          {grants.map((grant) => (
            <TransferRow
              key={grant.grantId}
              grant={grant}
              disabled={busy}
              revoke={() => {
                if (!confirm(strings.transfer_revoke_confirm)) return;
                void act(outcome(revokeTransfer({ path: { grantId: grant.grantId } }), 204));
              }}
            />
          ))}
        </ul>
      )}
      {problem !== null && (
        <Status inline>
          <ImportProblem problem={problem} />
        </Status>
      )}
    </section>
  );
}
