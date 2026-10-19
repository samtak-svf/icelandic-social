import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAccount } from "../account.tsx";
import { strings } from "../generated/brand/strings.ts";
import { Button, ProblemText } from "./kit.tsx";
import { UnreadBadge } from "./unread.tsx";

// Every page sits in this: the signed-in pages behind the navigation, and in
// place of them the sign-in page, a reload request or a failure with a retry.

export function Shell({ children }: Readonly<{ children: ReactNode }>) {
  const { state, refresh } = useAccount();
  switch (state.status) {
    case "loading":
      return (
        <Frame>
          <p role="status">{strings.loading}</p>
        </Frame>
      );
    case "signed-out":
      return <SignIn />;
    case "outdated":
      return (
        <Frame>
          <p role="alert">{strings.reload_required}</p>
          <Button tone="primary" className="mt-4" onClick={() => location.reload()}>
            {strings.reload}
          </Button>
        </Frame>
      );
    case "failed":
      return (
        <Frame>
          <p role="alert">
            <ProblemText problem={state.problem} />
          </p>
          <Button tone="primary" className="mt-4" onClick={() => void refresh()}>
            {strings.try_again}
          </Button>
        </Frame>
      );
  }
  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="font-headline text-2xl">{strings.app_name}</span>
          <nav aria-label={strings.main_navigation}>
            <ul className="flex flex-wrap gap-1">
              <NavLink to="/">{strings.tab_me}</NavLink>
              <NavLink to="/communities">{strings.tab_communities}</NavLink>
              <NavLink to="/notifications">
                {strings.tab_notifications}
                <UnreadBadge />
              </NavLink>
              <NavLink to="/settings">{strings.settings_title}</NavLink>
            </ul>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
    </>
  );
}

type Tab = "/" | "/communities" | "/notifications" | "/settings";

function NavLink({ to, children }: Readonly<{ to: Tab; children: ReactNode }>) {
  return (
    <li>
      <Link
        to={to}
        className="inline-flex min-h-11 items-center rounded-md px-3"
        activeProps={{ className: "bg-muted font-semibold" }}
        activeOptions={{ exact: to === "/" }}
      >
        {children}
      </Link>
    </li>
  );
}

function Frame({ children }: Readonly<{ children: ReactNode }>) {
  return <main className="mx-auto max-w-md px-4 py-16">{children}</main>;
}

/**
 * Signing in is a full navigation to the Worker's start route, which sends the
 * browser to Google and back with the session cookie (decision 0062). Google
 * is the only way in; Kenni adds the mark afterwards (decision 0069).
 */
function SignIn() {
  return (
    <Frame>
      <h1 className="font-headline text-4xl">{strings.app_name}</h1>
      <h2 className="mt-8 text-xl font-semibold">{strings.sign_in_title}</h2>
      <a
        href="/auth/google/start"
        className="mt-4 flex min-h-11 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-fg"
      >
        {strings.sign_in_google}
      </a>
      <p className="mt-4 text-sm text-muted-fg">{strings.sign_in_hint}</p>
      <p className="mt-8 text-sm text-muted-fg">{strings.residency_claim}</p>
    </Frame>
  );
}
