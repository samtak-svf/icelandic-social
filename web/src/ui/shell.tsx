import { Link, useLocation, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAccount } from "../account.tsx";
import { strings } from "../generated/brand/strings.ts";
import { signInHref } from "../lib/sign-in-href.ts";
import { SuspendedNotice } from "../social/suspended.tsx";
import { Button, ProblemText } from "./kit.tsx";
import { UnreadBadge } from "./unread.tsx";

// Every page sits in this: the signed-in pages behind the navigation, and in
// place of them the sign-in page, a reload request or a failure with a retry.
// The privacy policy and support pages (/privacy, /support) are public so
// anyone and any store listing can read them without signing in (#383), and
// so is the tester guide (/testers, #350), read before the app is installed.

const PUBLIC_PATHS = new Set(["/privacy", "/support", "/testers"]);

export function Shell({ children }: Readonly<{ children: ReactNode }>) {
  const { state, refresh } = useAccount();
  const pathname = useLocation({ select: (l) => l.pathname });
  const wide = useMatches({ select: (ms) => ms.some((m) => m.staticData.width === "wide") });
  const noNotice = useMatches({ select: (ms) => ms.some((m) => m.staticData.noSuspendedNotice) });
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
  // A compact window has the four places in a bar at the bottom of the
  // screen and the name above the page; from medium up both give way to a
  // rail down the left edge (decisions 0080, 0087). The notifications are no
  // place: they are the bell at the right of the top bar, with the unseen
  // count, at every width (decision 0109), its edge in line with the page's.
  // The size classes are the contract's (`medium:`, generated).
  // `--tabbar-height` is what a bottom-pinned box (the comment box) keeps
  // clear of. A route that lays out more than one column on an expanded window
  // says so (`staticData.width`).
  const column = `mx-auto max-w-2xl px-4 ${wide ? "expanded:max-w-6xl" : ""}`;
  return (
    <div className="[--tabbar-height:3.5rem] medium:pl-24 medium:[--tabbar-height:0px]">
      <header>
        <div className={`${column} flex items-center gap-2 py-2`}>
          <span data-app-name className="font-headline text-2xl medium:hidden">
            {strings.app_name}
          </span>
          <Bell />
        </div>
      </header>
      <nav
        aria-label={strings.main_navigation}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg medium:inset-x-auto medium:top-0 medium:left-0 medium:flex medium:w-24 medium:flex-col medium:items-center medium:gap-4 medium:border-t-0 medium:border-r medium:py-4"
      >
        <span
          data-app-name
          className="hidden max-w-full px-2 text-center font-headline text-2xl [overflow-wrap:anywhere] medium:block"
        >
          {strings.app_name}
        </span>
        <ul className="mx-auto flex max-w-2xl justify-around gap-0 medium:gap-1 medium:mx-0 medium:w-full medium:flex-col medium:px-2">
          <NavLink to="/" icon={<FeedIcon />}>
            {strings.tab_feed}
          </NavLink>
          <NavLink to="/me" icon={<PersonIcon />}>
            {strings.tab_me}
          </NavLink>
          <NavLink to="/communities" icon={<PeopleIcon />}>
            {strings.tab_communities}
          </NavLink>
          <NavLink to="/conversations" icon={<ChatIcon />}>
            {strings.tab_conversations}
          </NavLink>
          <NavLink to="/settings" icon={<GearIcon />}>
            {strings.settings_title}
          </NavLink>
        </ul>
      </nav>
      <main className={`${column} py-6 pb-[calc(var(--tabbar-height)+1.5rem)] medium:pb-6`}>
        {!noNotice && <SuspendedNotice />}
        {children}
      </main>
    </div>
  );
}

type Tab = "/" | "/me" | "/communities" | "/conversations" | "/settings";

/**
 * The bell at the right of the top bar (decision 0109): named, with the unseen
 * count drawn on it and read out with the name, and `aria-current` on the
 * notifications page as on a place in the navigation.
 */
function Bell() {
  return (
    <Link
      to="/notifications"
      className="relative ml-auto inline-flex size-11 items-center justify-center rounded-full"
      activeProps={{ className: "bg-muted text-primary" }}
      inactiveProps={{ className: "text-fg" }}
    >
      <BellIcon />
      <span className="sr-only">{strings.notifications_title}</span>
      <UnreadBadge className="absolute right-0.5 top-0.5 min-w-4 px-1 text-center text-xs" />
    </Link>
  );
}

function NavLink({
  to,
  icon,
  children,
}: Readonly<{ to: Tab; icon: ReactNode; children: ReactNode }>) {
  return (
    <li className="flex-1 medium:flex-none">
      <Link
        to={to}
        // aria-current="page" is set by the link itself on the place shown. The current place is
        // marked by colour, not weight: a bold name can be wider than its slot at 360 px.
        className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md px-0.5 text-center text-xs [overflow-wrap:anywhere] medium:min-h-16 medium:px-1"
        activeProps={{ className: "bg-muted text-fg" }}
        inactiveProps={{ className: "text-muted-fg" }}
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

const FeedIcon = () => (
  <Icon>
    <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />
  </Icon>
);
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
        <Link to="/testers" className="underline">
          {strings.testers_title}
        </Link>
      </p>
    </Frame>
  );
}
