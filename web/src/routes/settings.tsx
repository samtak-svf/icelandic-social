import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "../account.tsx";
import { refused, type Problem } from "../problem.ts";
import { endOtherSessions, endSession, listSessions, type SessionInfo } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDate } from "../lib/is-format.ts";
import { NotificationSettingsSection } from "../social/notification-settings.tsx";
import { deviceIcon } from "../ui/device-icon.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { VerifyCta } from "../ui/verify.tsx";

// Settings: where this account is signed in, and signing out (decision 0061).
// Ending another session signs that client out at once; a phone's device goes
// with its session. Signing out is ending this one.
export const Route = createFileRoute("/settings")({ component: Settings });

type Sessions = { status: "loading" } | { status: "ready"; sessions: SessionInfo[] };

function Settings() {
  const { refresh, signedOut } = useAccount();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Sessions>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const load = useCallback(async () => {
    try {
      const answer = await listSessions();
      if (answer.status === 200) setSessions({ status: "ready", sessions: answer.data.sessions });
      else if (answer.status === 401) await refresh();
      else setProblem(refused(answer.data));
    } catch {
      setProblem({ kind: "unreachable" });
    }
  }, [refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one change, then reads the list again; a 401 means this session is gone. */
  async function change(act: () => Promise<{ status: number; data: unknown }>, ok: number) {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await act();
      if (answer.status === ok) await load();
      else if (answer.status === 401) await refresh();
      else setProblem(refused(answer.data));
    } catch {
      setProblem({ kind: "unreachable" });
    } finally {
      setBusy(false);
    }
  }

  async function signOut(current: SessionInfo) {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await endSession({ path: { sessionId: current.sessionId } });
      if (answer.status === 204 || answer.status === 401) {
        signedOut();
        await navigate({ to: "/" });
      } else setProblem(refused(answer.data));
    } catch {
      setProblem({ kind: "unreachable" });
    } finally {
      setBusy(false);
    }
  }

  const list = sessions.status === "ready" ? sessions.sessions : [];
  const current = list.find((session) => session.current);
  const others = list.filter((session) => !session.current);

  return (
    <>
      <h1 className="font-headline text-3xl">{strings.settings_title}</h1>
      <div className="mt-6">
        <VerifyCta />
      </div>
      <p className="mt-6">
        <Link to="/statements" className="underline">
          {strings.statements_title}
        </Link>
      </p>
      <section aria-labelledby="sessions" className="mt-6">
        <h2 id="sessions" className="text-xl font-semibold">
          {strings.sessions_title}
        </h2>
        <p className="text-sm text-muted-fg">{strings.sessions_hint}</p>
        {sessions.status === "loading" ? (
          <p role="status" className="mt-4">
            {strings.loading}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {list.map((session) => (
              <li
                key={session.sessionId}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-[30px] items-center justify-center rounded-lg bg-muted">
                    {deviceIcon(session.kind)}
                  </span>
                  <div>
                    <p className="font-medium">{name(session)}</p>
                    <p className="text-sm text-muted-fg">
                      {session.current ? strings.session_this : when(session)}
                    </p>
                  </div>
                </div>
                {!session.current && (
                  <Button
                    tone="danger"
                    disabled={busy}
                    aria-label={`${strings.session_end}: ${name(session)}`}
                    onClick={() => {
                      if (confirm(confirmation(session)))
                        void change(
                          () => endSession({ path: { sessionId: session.sessionId } }),
                          204,
                        );
                    }}
                  >
                    {strings.session_end}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {others.length > 1 && (
          <Button
            tone="danger"
            className="mt-4"
            disabled={busy}
            onClick={() => {
              if (confirm(strings.sessions_end_others_confirm)) void change(endOtherSessions, 200);
            }}
          >
            {strings.sessions_end_others}
          </Button>
        )}
      </section>
      <NotificationSettingsSection />
      <section className="mt-10">
        <Button
          tone="primary"
          disabled={busy || !current}
          onClick={() => current && void signOut(current)}
        >
          {strings.sign_out}
        </Button>
      </section>
      <p className="mt-8 flex flex-wrap gap-4 text-sm text-muted-fg">
        <Link to="/privacy" className="underline">
          {strings.privacy_title}
        </Link>
        <Link to="/support" className="underline">
          {strings.support_title}
        </Link>
      </p>
      <Status>{problem !== null && <ProblemText problem={problem} />}</Status>
    </>
  );
}

function name(session: SessionInfo): string {
  if (session.kind === "android") return strings.session_android;
  if (session.kind === "ios") return strings.session_ios;
  if (session.browser === null) return strings.session_browser_unknown;
  if (session.os === null) return session.browser;
  return strings.session_browser({ browser: session.browser, os: session.os });
}

function when(session: SessionInfo): string {
  const date = formatIsDate(session.lastSeenAt);
  return session.kind === "web"
    ? strings.session_last_seen({ date })
    : strings.session_signed_in({ date });
}

function confirmation(session: SessionInfo): string {
  return session.kind === "web" ? strings.session_end_confirm : strings.device_revoke_confirm;
}
