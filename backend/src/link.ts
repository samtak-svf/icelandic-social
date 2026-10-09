import { Hono } from "hono";
import ids from "../../identifiers/ids.json" with { type: "json" };
import { brandStrings } from "./brand.gen.ts";
import { appLinks } from "./env/index.ts";
import { type Invite, resolveInvite } from "./invites.ts";

// The link host (decision 0019): the page an invite link opens in a browser,
// and the files that let Android and iOS open such links in the app instead.
// The page says no more than GET /v1/invites/{token} does.

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
};

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(body: string, status: number): Response {
  const html = `<!doctype html>
<html lang="is">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(brandStrings.app_name)}</title>
<style>
  body { font: 18px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; }
  a.open { display: inline-block; padding: .75rem 1.25rem; border-radius: .75rem;
           background: #1f2937; color: #fff; text-decoration: none; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #eee; } a.open { background: #e5e7eb; color: #111; }
  }
</style>
<body>
${body}
</body>
</html>
`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

function heading(invite: Invite): string {
  const name = invite.inviter?.name;
  return name
    ? brandStrings.link_invited_by.replace("{name}", () => name)
    : brandStrings.link_invited;
}

/** The invite page for a live token, or the expired page. */
async function invitePage(env: Env, token: string): Promise<Response> {
  const invite = TOKEN.test(token) ? await resolveInvite(env, token) : null;
  if (!invite) return page(`<h1>${escape(brandStrings.link_expired)}</h1>`, 404);
  const open = `${ids.store.urlScheme}://invite/${token}`;
  return page(
    `<h1>${escape(heading(invite))}</h1>
<p><a class="open" href="${escape(open)}">${escape(brandStrings.link_open_in_app)}</a></p>
<p>${escape(brandStrings.link_test_group)}</p>`,
    200,
  );
}

/** Digital Asset Links: the Android app may open this host's /l/ links. */
function assetLinks(env: Env): Response {
  const { androidFingerprints } = appLinks(env);
  return Response.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ids.store.androidApplicationId,
        sha256_cert_fingerprints: androidFingerprints,
      },
    },
  ]);
}

/** The apple-app-site-association file: the iOS apps may open /l/ links. */
function appleAppSiteAssociation(env: Env): Response {
  const { appleAppIds } = appLinks(env);
  return Response.json({
    applinks: {
      details: [{ appIDs: appleAppIds, components: [{ "/": `${ids.hosts.linkPathPrefix}*` }] }],
    },
  });
}

/**
 * Google's redirect (decision 0033). Google refuses a custom scheme for a web
 * client, so the code comes here and goes on to the app's scheme. Only
 * `code`, `state` and `error` pass; PKCE makes the code useless without the
 * verifier the app holds.
 */
function googleRedirect(url: URL): Response {
  const onward = new URLSearchParams();
  for (const key of ["code", "state", "error"]) {
    const value = url.searchParams.get(key);
    if (value !== null) onward.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: `${ids.store.urlScheme}:/google?${onward}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

/** The link host's routes, outside the API and its contract. */
export function linkHost() {
  const host = new Hono<{ Bindings: Env }>();
  host.get(`${ids.hosts.linkPathPrefix}:token`, (c) =>
    invitePage(c.env, c.req.param("token") ?? ""),
  );
  host.get("/oauth/google", (c) => googleRedirect(new URL(c.req.url)));
  host.get("/.well-known/assetlinks.json", (c) => assetLinks(c.env));
  host.get("/.well-known/apple-app-site-association", (c) => appleAppSiteAssociation(c.env));
  return host;
}
