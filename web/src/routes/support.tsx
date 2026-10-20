import { createFileRoute, Link } from "@tanstack/react-router";
import { strings } from "../generated/brand/strings.ts";

// Public support page (/support, decision 0009, #383), linked from the web
// sign-in screen, settings, and store listings (brand.json support-site).
export const Route = createFileRoute("/support")({ component: SupportPage });

function SupportPage() {
  return (
    <article className="space-y-6">
      <h1 className="font-headline text-3xl">{strings.support_title}</h1>
      <p className="text-sm leading-relaxed text-muted-fg">{strings.support_intro}</p>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{strings.support_contact_heading}</h2>
        <p className="text-sm leading-relaxed text-muted-fg">{strings.support_contact_body}</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{strings.support_account_heading}</h2>
        <p className="text-sm leading-relaxed text-muted-fg">{strings.support_account_body}</p>
      </section>
      <p className="pt-2 text-sm">
        <Link to="/privacy" className="underline">
          {strings.privacy_title}
        </Link>
      </p>
    </article>
  );
}
