import { createFileRoute, Link } from "@tanstack/react-router";
import { strings } from "../generated/brand/strings.ts";

// Public privacy policy page (/privacy, decision 0009, #383), linked from the
// web sign-in screen, settings, and store listings (brand.json support-site).
export const Route = createFileRoute("/privacy")({ component: PrivacyPage });

function PrivacyPage() {
  return (
    <article className="space-y-6">
      <h1 className="font-headline text-3xl">{strings.privacy_title}</h1>
      <p className="font-medium">{strings.residency_claim}</p>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{strings.privacy_controller_heading}</h2>
        <p className="text-sm leading-relaxed text-muted-fg">{strings.privacy_controller_body}</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{strings.privacy_data_heading}</h2>
        <p className="text-sm leading-relaxed text-muted-fg">{strings.privacy_data_body}</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{strings.privacy_retention_heading}</h2>
        <p className="text-sm leading-relaxed text-muted-fg">{strings.privacy_retention_body}</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{strings.privacy_rights_heading}</h2>
        <p className="text-sm leading-relaxed text-muted-fg">{strings.privacy_rights_body}</p>
      </section>
      <p className="pt-2 text-sm">
        <Link to="/support" className="underline">
          {strings.support_title}
        </Link>
      </p>
    </article>
  );
}
