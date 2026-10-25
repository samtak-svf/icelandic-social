import { useState } from "react";
import { revealAuthor } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { outcome } from "./outcome.ts";

/**
 * Sýna höfund: a moderator asks for the author of an anonymous post. The
 * community's log records who asked (decision 0091), so it is confirmed first.
 */
export function RevealAuthor({ postId }: Readonly<{ postId: string }>) {
  const [name, setName] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function reveal() {
    if (!confirm(strings.anonymous_reveal_confirm)) return;
    setProblem(null);
    const done = await outcome(revealAuthor({ path: { postId } }), 200);
    if (done.ok) setName(done.data.name ?? strings.person_unnamed);
    else setProblem(done.problem);
  }

  return (
    <>
      {name === null ? (
        <Button onClick={() => void reveal()}>{strings.anonymous_reveal}</Button>
      ) : (
        <p className="font-semibold">{strings.anonymous_revealed({ name })}</p>
      )}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </>
  );
}
