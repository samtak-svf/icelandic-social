import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAccount } from "../account.tsx";
import { strings } from "../generated/brand/strings.ts";
import { signInHref } from "../lib/sign-in-href.ts";
import { Button, ProblemText } from "./kit.tsx";
import { UnreadBadge } from "./unread.tsx";

// Every page sits in this: the signed-in pages behind the navigation, and in
// place of them the sign-in page, a reload request or a failure with a retry.
// The privacy policy and support pages (/privacy, /support) are public so
// anyone and any store listing can read them without signing in (#383).

const PUBLIC_PATHS = new Set(["/privacy", "/support"]);

export function Shell({ children }: Readonly<{ children: ReactNode }>) {
  const { state, refresh } = useAccount();
  const pathname = useLocation({ select: (l) => l.pathname });
  switch (state.status) {
    case "signed-out":
      if (PUBLIC_PATHS.has(pathname)) {
        return (
          <>
            <header className="border-b border-border">
              <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 px-4 py-3">
                <Link to="/" className="font-headline text-2xl">
                  {strings.app_name}
                </Link>
                <Link to="/" className="inline-flex min-h-11 items-center rounded-md px-3 text-sm">
                  {strings.sign_in_title}
                </Link>
              </div>
            </header>
            <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
          </>
        );
      }
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
    case "loading":
    case "signed-in":
      break;
  }
  // Below 640px the five places sit in a bar at the bottom of the screen,
  // above it in the header; `--tabbar-height` is what a bottom-pinned box
  // (the comment box) keeps clear of (decision 0080).
  return (
    <div className="[--tabbar-height:3.5rem] sm:[--tabbar-height:0px]">
      <header className="sm:border-b sm:border-border">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
          <span className="font-headline text-2xl">{strings.app_name}</span>
          <nav
            aria-label={strings.main_navigation}
            className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg sm:static sm:border-0"
          >
            <ul className="mx-auto flex max-w-2xl justify-around gap-1 sm:justify-end">
              <NavLink to="/" icon={<PersonIcon />}>
                {strings.tab_me}
              </NavLink>
              <NavLink to="/communities" icon={<PeopleIcon />}>
                {strings.tab_communities}
              </NavLink>
              <NavLink to="/conversations" icon={<ChatIcon />}>
                {strings.tab_conversations}
              </NavLink>
              <NavLink
                to="/notifications"
                icon={
                  <span className="relative">
                    <BellIcon />
                    <UnreadBadge className="absolute -right-2 -top-1 min-w-4 px-1 text-center text-xs" />
                  </span>
                }
              >
                {strings.tab_notifications}
              </NavLink>
              <NavLink to="/settings" icon={<GearIcon />}>
                {strings.settings_title}
              </NavLink>
            </ul>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 pb-[calc(var(--tabbar-height)+1.5rem)] sm:pb-6">
        {children}
      </main>
    </div>
  );
}

type Tab = "/" | "/communities" | "/conversations" | "/notifications" | "/settings";

function NavLink({
  to,
  icon,
  children,
}: Readonly<{ to: Tab; icon: ReactNode; children: ReactNode }>) {
  return (
    <li className="flex-1 sm:flex-none">
      <Link
        to={to}
        // aria-current="page" is set by the link itself on the place shown.
        className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md px-3 text-xs sm:min-h-11 sm:flex-row sm:gap-2 sm:text-base"
        activeProps={{ className: "bg-muted font-semibold" }}
        activeOptions={{ exact: to === "/" }}
      >
        {icon}
        <span>{children}</span>
      </Link>
    </li>
  );
}

function Icon({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const PersonIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);
const PeopleIcon = () => (
  <Icon>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2 20a7 7 0 0 1 14 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6 6 0 0 1 4 6" />
  </Icon>
);
const ChatIcon = () => (
  <Icon>
    <path d="M4 5h16v11H9l-5 4z" />
  </Icon>
);
const BellIcon = () => (
  <Icon>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />
  </Icon>
);
const GearIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
  </Icon>
);

function Frame({ children }: Readonly<{ children: ReactNode }>) {
  return <main className="mx-auto max-w-md px-4 py-16">{children}</main>;
}

/**
 * Signing in is a full navigation to the Worker's start route, which sends the
 * browser to Google and back with the session cookie (decision 0062). Google
 * is the only way in; Kenni adds the mark afterwards (decision 0069). It comes
 * back to the page that asked, so a shared link survives signing in.
 */
function SignIn() {
  const href = useLocation({ select: (l) => l.href });
  return (
    <Frame>
      <h1 className="font-headline text-4xl">{strings.app_name}</h1>
      <h2 className="mt-8 text-xl font-semibold">{strings.sign_in_title}</h2>
      <a
        href={signInHref(href)}
        className="mt-4 flex min-h-11 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-fg"
      >
        {strings.sign_in_google}
      </a>
      <p className="mt-4 text-sm text-muted-fg">{strings.sign_in_hint}</p>
      <p className="mt-8 text-sm text-muted-fg">{strings.residency_claim}</p>
      <p className="mt-4 flex flex-wrap gap-4 text-sm text-muted-fg">
        <Link to="/privacy" className="underline">
          {strings.privacy_title}
        </Link>
        <Link to="/support" className="underline">
          {strings.support_title}
        </Link>
      </p>
    </Frame>
  );
}
