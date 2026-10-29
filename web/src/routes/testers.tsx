import { createFileRoute, Link } from "@tanstack/react-router";
import playInvite from "../assets/testers/play-invite.webp?url";
import playListing from "../assets/testers/play-listing.webp?url";
import playTester from "../assets/testers/play-tester.webp?url";
import { strings } from "../generated/brand/strings.ts";

// Public tester guide (/testers, #350): the store screens a new tester passes
// on Android and iPhone, in order, and why they say the app is unreviewed.
// It is the one link sent to a would-be tester (decision 0084), and the web
// sign-in screen links to it.
export const Route = createFileRoute("/testers")({ component: TestersPage });

// A step is its text plus the store screens it shows, when it has any. The
// sizes are the intrinsic ones, so the page does not shift while they load.
const PLATFORMS = [
  {
    id: "android",
    heading: strings.testers_android_heading,
    steps: [
      { text: strings.testers_android_step_open },
      {
        text: strings.testers_android_step_accept,
        images: [
          { src: playInvite, alt: strings.testers_image_play_invite_alt, width: 720, height: 936 },
        ],
      },
      {
        text: strings.testers_android_step_install,
        images: [
          { src: playTester, alt: strings.testers_image_play_tester_alt, width: 720, height: 1008 },
          {
            src: playListing,
            alt: strings.testers_image_play_listing_alt,
            width: 720,
            height: 1324,
          },
        ],
      },
      { text: strings.testers_android_step_wait },
      { text: strings.testers_last_step },
    ],
  },
  {
    id: "iphone",
    heading: strings.testers_iphone_heading,
    steps: [
      { text: strings.testers_iphone_step_invite },
      { text: strings.testers_iphone_step_testflight },
      { text: strings.testers_iphone_step_group },
      { text: strings.testers_iphone_step_install },
      { text: strings.testers_last_step },
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
              <li key={step.text}>
                {step.text}
                {"images" in step && (
                  <div className="flex flex-wrap gap-3">
                    {step.images.map((img) => (
                      <img
                        key={img.src}
                        src={img.src}
                        alt={img.alt}
                        width={img.width}
                        height={img.height}
                        loading="lazy"
                        className="mt-2 h-auto w-full max-w-xs rounded-md border border-border"
                      />
                    ))}
                  </div>
                )}
              </li>
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
