import { type ReactNode, useCallback, useState } from "react";
import {
  approveTransferRequest,
  denyTransferRequest,
  getTransferRequest,
  type TransferRequest,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { outcome, useLoad, type Outcome } from "../social/outcome.ts";
import { Button, Status } from "../ui/kit.tsx";
import { ImportProblem } from "./shared.tsx";
import { SCOPE_WORD } from "./transfer-section.tsx";

// The consent screen an exporter sends a person to (decision 0129). Allowing or refusing
// answers with where the browser goes back to, the exporter's own address.

/** What the exporter asks for, and the two answers. */
export function ConsentView({
  request,
  answer,
  busy = false,
  problem = null,
}: Readonly<{
  request: TransferRequest;
  answer: (allow: boolean) => void;
  busy?: boolean;
  problem?: Problem | null;
}>) {
  const client = request.clientName;
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.transfer_consent_title({ client })}</h1>
      <p className="mt-2">{strings.transfer_consent_body({ client })}</p>
      <p className="mt-4 font-medium">{strings.transfer_consent_what}</p>
      <ul className="mt-1 list-disc ps-6">
        {request.scopes.map((scope) => (
          <li key={scope}>{SCOPE_WORD[scope]}</li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button tone="primary" onClick={() => answer(true)} disabled={busy}>
          {strings.transfer_allow}
        </Button>
        <Button onClick={() => answer(false)} disabled={busy}>
          {strings.transfer_deny}
        </Button>
      </div>
      {problem !== null && (
        <Status inline>
          <ImportProblem problem={problem} />
        </Status>
      )}
    </>
  );
}

/** The loaded request, or the sentence for one that is gone. */
export function ConsentState({
  loaded,
  children,
}: Readonly<{
  loaded: Outcome<TransferRequest>;
  children: (request: TransferRequest) => ReactNode;
}>) {
  if (loaded.ok) return <>{children(loaded.data)}</>;
  return (
    <Status>
      {loaded.status === 404 ? (
        strings.transfer_consent_gone
      ) : (
        <ImportProblem problem={loaded.problem} />
      )}
    </Status>
  );
}

export function TransferConsent({ requestId }: Readonly<{ requestId: string }>) {
  const load = useCallback(
    () => outcome(getTransferRequest({ path: { requestId } }), 200),
    [requestId],
  );
  const [loaded] = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const answer = async (allow: boolean) => {
    setBusy(true);
    setProblem(null);
    const call = allow ? approveTransferRequest : denyTransferRequest;
    const result = await outcome(call({ path: { requestId } }), 200);
    if (result.ok) {
      window.location.assign(result.data.redirect);
      return;
    }
    setBusy(false);
    setProblem(result.problem);
  };
  if (loaded === null) return null;
  return (
    <ConsentState loaded={loaded}>
      {(request) => (
        <ConsentView
          request={request}
          answer={(allow) => void answer(allow)}
          busy={busy}
          problem={problem}
        />
      )}
    </ConsentState>
  );
}
