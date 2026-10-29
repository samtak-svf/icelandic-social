import { createFileRoute, Link } from "@tanstack/react-router";
import { strings } from "../generated/brand/strings.ts";

// Public tester guide (/testers, #350): the store screens a new tester passes
// on Android and iPhone, in order, and why they say the app is unreviewed.
// It is the one link sent to a would-be tester (decision 0084), and the web
// sign-in screen links to it.
export const Route = createFileRoute("/testers")({ component: TestersPage });

const PLATFORMS = [
  {
    id: "android",
    heading: strings.testers_android_heading,
    steps: [
      strings.testers_android_step_open,
      strings.testers_android_step_accept,
      strings.testers_android_step_install,
      strings.testers_android_step_wait,
      strings.testers_last_step,
    ],
  },
  {
    id: "iphone",
    heading: strings.testers_iphone_heading,
    steps: [
      strings.testers_iphone_step_invite,
      strings.testers_iphone_step_testflight,
      strings.testers_iphone_step_group,
      strings.testers_iphone_step_install,
      strings.testers_last_step,
    ],
  },
] as const;

function TestersPage() {
  return (
    <article className="space-y-6">
      <h1 className="font-headline text-3xl">{strings.testers_title}</h1>
      <p className="text-sm leading-relaxed text-muted-fg">{strings.testers_intro}</p>
      <nav className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <a
            key={p.id}
            href={`#${p.id}`}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium"
          >
            {p.heading}
          </a>
        ))}
      </nav>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{strings.testers_unreviewed_heading}</h2>
        <p className="text-sm leading-relaxed text-muted-fg">{strings.testers_unreviewed_body}</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{strings.testers_join_heading}</h2>
        <p className="text-sm leading-relaxed text-muted-fg">{strings.testers_join_body}</p>
      </section>
      {PLATFORMS.map((p) => (
        <section key={p.id} id={p.id} className="scroll-mt-4 space-y-2">
          <h2 className="text-xl font-semibold">{p.heading}</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-fg">
            {p.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ))}
      <p className="text-sm leading-relaxed text-muted-fg">{strings.testers_help}</p>
      <p className="pt-2 text-sm">
        <Link to="/support" className="underline">
          {strings.support_title}
        </Link>
      </p>
    </article>
  );
}
