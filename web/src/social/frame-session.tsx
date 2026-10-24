import { useState, type ReactNode } from "react";
import type { FrameKind, Framing } from "../generated/frames.ts";
import { masterOf } from "../photo.ts";
import { FrameSheet } from "./frame-sheet.tsx";
import { getMaster, putFrames, type SendProblem, type Target } from "./frame-send.ts";

// Opens the crop sheet for the three framed images (decision 0086), for a file
// just chosen or for an image already set. The caller says what saving does.

type Session = {
  kind: FrameKind;
  source: Blob;
  stored: Framing | null;
  commit: (framing: Framing | null) => Promise<SendProblem | null>;
};

export function useFrameSession(): {
  /** The sheet while one is open; render it anywhere. */
  sheet: ReactNode;
  /**
   * Scales `file` to a master and opens the sheet on it. `commit` gets the master and the
   * framing (null when the person left it as it was). Returns the problem when the file cannot
   * be used, else null.
   */
  choose: (
    kind: FrameKind,
    file: Blob,
    commit: (master: Blob, framing: Framing | null) => Promise<SendProblem | null>,
  ) => Promise<SendProblem | null>;
  /** Opens the sheet on the master the server kept; the problem, or null when it opened. */
  reframe: (
    kind: FrameKind,
    target: Target,
    stored: Framing | null,
    done: () => void,
  ) => Promise<SendProblem | null>;
} {
  const [session, setSession] = useState<Session | null>(null);

  const sheet = session && (
    <FrameSheet
      kind={session.kind}
      source={session.source}
      stored={session.stored}
      save={async (framing) => {
        const failed = await session.commit(framing);
        if (failed === null) setSession(null);
        return failed;
      }}
      cancel={() => setSession(null)}
    />
  );

  async function choose(
    kind: FrameKind,
    file: Blob,
    commit: (master: Blob, framing: Framing | null) => Promise<SendProblem | null>,
  ) {
    let master: Blob | "too_large";
    try {
      master = await masterOf(file);
    } catch {
      return "invalid_image" as const;
    }
    if (master === "too_large") return master;
    const source = master;
    setSession({ kind, source, stored: null, commit: (framing) => commit(source, framing) });
    return null;
  }

  async function reframe(
    kind: FrameKind,
    target: Target,
    stored: Framing | null,
    done: () => void,
  ) {
    const source = await getMaster(target);
    if (!(source instanceof Blob)) return source;
    setSession({
      kind,
      source,
      stored,
      commit: async (framing) => {
        const failed = framing === null ? null : await putFrames(target, framing);
        if (failed === null) done();
        return failed;
      },
    });
    return null;
  }

  return { sheet, choose, reframe };
}
