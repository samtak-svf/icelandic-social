// Worker spjall-api: the REST API and the MLS delivery service (plan §4).
// Built, tested and deployed by the `cf` CLI from this file alone (decision 0032).
//
// ACCOUNT: Samtak's own Cloudflare account (decision 0031). Every name below is
// a frozen id from identifiers/ids.json; `node tooling/jurisdiction-check.mjs`
// fails when the two disagree or when a bucket loses its jurisdiction.
//
// D1 and R2 exist, both in the EU jurisdiction (decision 0001). A deploy may
// provision a missing one WITHOUT a jurisdiction, which can never be added
// afterwards, so every deploy runs `cf deploy --no-provision` behind
// `jurisdiction-check.mjs --deploy`. The deploy and its tokens are in
// backend/README.md.
import { bindings, defineConfig, exports, triggers } from "cf/config";
import { devOrigin } from "./dev-origin.ts";

/**
 * The fake provider's issuer in the modes that run one. Interop's is the local
 * dev server. Staging's address is not in this repository, so dev/staging-app.ts
 * replaces this placeholder per request with the origin the request came to.
 */
const fakeIssuer = (mode: string | undefined, path: string, real: string) => {
  if (mode === "interop") return `${devOrigin()}${path}`;
  return mode === "staging" ? `https://staging.invalid${path}` : real;
};

/** What differs by resource between production and staging. */
const PRODUCTION = {
  worker: "spjall-api",
  d1: { name: "spjall-db", id: "7d38bae5-7ee1-4ff4-af95-49a1afbbdbbb" },
  media: "spjall-media",
  profiles: "spjall-profiles",
  domains: ["spjall.samtak.is"],
  apnsTeam: "B4724Z74TM",
  apnsTopic: "is.samtak.spjall.beta",
  // 1003 was Fljótið's (decision 0034, removed by 0044) and is not reused.
  limits: { public: "1001", claim: "1002", photo: "1004" },
};
const STAGING: typeof PRODUCTION = {
  worker: "spjall-api-staging",
  d1: { name: "spjall-db-staging", id: "41fd07d9-63b0-4ad6-9901-13a11526589b" },
  media: "spjall-media-staging",
  profiles: "spjall-profiles-staging",
  // No custom domain: it answers on workers.dev, behind its gate.
  domains: [],
  // It pushes to nobody.
  apnsTeam: "",
  apnsTopic: "",
  // Its own counters, 1000 above production's.
  limits: { public: "2001", claim: "2002", photo: "2004" },
};

/** A dev entry for the modes that have one; every other mode, and every deploy of production, runs src/index.ts. */
const entrypointOf = (mode: string | undefined) => {
  if (mode === "interop") return "dev/worker.ts";
  return mode === "staging" ? "dev/staging.ts" : "src/index.ts";
};

// `cf build --mode staging` and `cf deploy --mode staging` make the staging
// Worker (decision 0118): the same Worker on its own storage, with the fake
// sign-in, behind a gate. Every staging value below is held by
// `jurisdiction-check.mjs`, which also fails if a production name appears here
// for staging or a staging one for production.
export default defineConfig(({ mode }) => {
  const own = mode === "staging" ? STAGING : PRODUCTION;
  return {
    accountId: "af4d4a9c4527ce1e46d0c2dc1165e801",
    worker: {
      name: own.worker,
      compatibilityDate: "2026-08-22",
      // TanStack Start's server build imports node:async_hooks and node:stream
      // (decision 0062); the API itself uses neither.
      compatibilityFlags: ["nodejs_compat"],
      // `cf dev --mode interop` runs dev/worker.ts, the real Worker plus a fake
      // Kenni and Google, for the interop test (interop.yml) and the web's
      // Playwright run (web.yml). Staging runs dev/staging.ts, the same fakes
      // behind its gate. Every other mode, and every production deploy, runs
      // src/index.ts; `jurisdiction-check.mjs` holds that.
      entrypoint: entrypointOf(mode),
      // The gate answers before anything else, static files included, so on
      // staging they do not get served ahead of the Worker.
      ...(mode === "staging" && { assets: { runWorkerFirst: true } }),
      observability: { enabled: true },
      // Every authenticated request makes two or more D1 round trips, and D1's
      // primary answers from Milan (EEUR, colo MXP). The Worker runs in the
      // cloud region next to it, so the client pays one long hop instead of
      // several (decision 0056). Smart Placement kept a quiet Worker at the
      // edge (`cf-placement: local-KEF`, ~65 ms per D1 query), so the region is
      // named. It moves only where the code runs, on Cloudflare's network; no
      // data moves. `jurisdiction-check.mjs` holds it to an EU region.
      placement: { region: "aws:eu-south-1" },
      // The Worker answers only on the frozen API host (ids.json hosts.api), as
      // a custom domain on the samtak.is zone; workers.dev stays off so there is
      // one public address. `jurisdiction-check.mjs` holds both. Staging has no
      // custom domain and answers on workers.dev, behind its gate.
      domains: own.domains,
      workersDev: mode === "staging",
      // Once a day the Worker deletes media past its 30 days (decision 0023). An
      // R2 lifecycle rule on spjall-media is the backstop, made with the bucket
      // (backend/README.md). Every minute it runs the jobs that are due (0067).
      triggers: [
        triggers.scheduled({ schedule: "17 3 * * *" }),
        triggers.scheduled({ schedule: "* * * * *" }),
      ],
      // Read only through src/env/ (tooling/seam-guard.mjs).
      env: {
        // The web app's built files (decision 0062), served by Cloudflare before
        // the Worker runs; every other path reaches src/index.ts.
        ASSETS: bindings.assets(),
        // The oldest client build that may talk to this Worker, per platform.
        // Raised when a protocol change would break older builds; the apps read
        // it from /health and ask the user to update. 0.5.0: builds before it
        // open on Fljótið, whose routes are gone (decision 0044).
        MIN_CLIENT_VERSION_ANDROID: bindings.text("0.5.0"),
        MIN_CLIENT_VERSION_IOS: bindings.text("0.5.0"),
        // The web's floor is the version of the web build this Worker serves,
        // raised by the deploy that ships a new one, so every older tab is
        // refused with 426 and reloads. 0.2.0 is the first to read a notice with
        // no community and a tombstone (decisions 0114, 0115). 0.4.0 is the first
        // to word reports waiting; an older tab would fail on that row.
        MIN_CLIENT_VERSION_WEB: bindings.text("0.4.0"),
        // The first app version whose core has the reply kind. Below it a reply is withheld
        // from the list and the counts, though such an app still decodes the rest (decision
        // 0114). Not a floor: an older app goes on working.
        REPLY_NOTICE_CLIENT_VERSION: bindings.text("0.17.0"),
        // The first app version that decodes a notification with no community and
        // any kind, and draws a tombstone and a review's notice. Below it, those are
        // withheld, and it is not a floor: an older app goes on working (decisions
        // 0114, 0115).
        NOTICE_CLIENT_VERSION: bindings.text("0.19.0"),
        // The first app version that words a suspension's notice. Below it the
        // action reads as "unknown", which an app words as a removal, so those
        // notices are withheld (decision 0115). Raised to the version that takes the
        // core with these actions, and not a floor either.
        SUSPENSION_NOTICE_CLIENT_VERSION: bindings.text("0.20.0"),
        // The version from which an app words a friend's notice (decision 0114): above what the
        // release now going out knows, so a notice waits for the release whose core has the kind.
        FRIEND_NOTICE_CLIENT_VERSION: bindings.text("0.21.0"),
        // The version from which an app words a notice of reports waiting (decision 0115): no
        // app has a platform screen, so this is above them all until one does. Not a floor.
        REPORTS_NOTICE_CLIENT_VERSION: bindings.text("999.0.0"),
        // The version from which an app knows a wall's notices (decision 0115): the release whose
        // core has the wall, the same as a friend's since that core has both. Not a floor.
        WALL_NOTICE_CLIENT_VERSION: bindings.text("0.21.0"),
        // Where a client below its floor gets a current build (decision 0030),
        // published by /health and the 426 body. Android's is the internal
        // track's opt-in link while the app is not on a public listing; iOS's is
        // TestFlight's scheme. Unset, the brand's value and itms-beta:// apply.
        UPDATE_URL_ANDROID: bindings.text(
          "https://play.google.com/apps/internaltest/4701643324608289838",
        ),
        UPDATE_URL_IOS: bindings.text("itms-beta://"),
        // Kenni's issuer for this Samtak team (decision 0019). The Worker reads
        // its discovery document; the apps get the authorize endpoint from
        // /v1/sign-in. The interop run signs in with dev/worker.ts's fake Kenni.
        KENNI_ISSUER: bindings.text(
          fakeIssuer(mode, "/dev/kenni", "https://idp.kenni.is/innskraning.is"),
        ),
        // Google, the first way to sign in (decision 0033): its issuer, and the
        // web client the consent screen belongs to. The client id is not a
        // frozen id; the apps get it from /v1/sign-in. Left empty, Google sign-in
        // answers 503 and Kenni still works. The interop run signs in with
        // dev/worker.ts's fake Google.
        GOOGLE_ISSUER: bindings.text(
          fakeIssuer(mode, "/dev/google", "https://accounts.google.com"),
        ),
        GOOGLE_CLIENT_ID: bindings.text(
          mode === "interop" || mode === "staging"
            ? "fake-google-client"
            : "654764079866-26282k1r7oltsqt2gv71hl92jmbd8pjv.apps.googleusercontent.com",
        ),
        // The link host's association files (decision 0019). Empty until the
        // store accounts exist: the Play app-signing certificate's SHA-256
        // fingerprints, comma-separated, and the Apple team of is.samtak.spjall.
        ANDROID_CERT_SHA256: bindings.text(""),
        APPLE_TEAM_ID: bindings.text(""),
        // APNs (decision 0025): the team that owns the APNs key, and the bundle
        // id pushed to. The interim team and bundle id until Samtak's team
        // exists (decision 0011); `jurisdiction-check.mjs` holds them to ids.json.
        APNS_TEAM_ID: bindings.text(own.apnsTeam),
        APNS_TOPIC: bindings.text(own.apnsTopic),
        // Migrations are backend/migrations/, applied by
        // `cf d1 migrations apply <id> --dir migrations` (scripts/d1.ts).
        DB: bindings.d1(own.d1),
        MEDIA: bindings.r2({ name: own.media, jurisdiction: "eu" }),
        // Profile photos (decision 0039): one re-encoded WebP per account, kept
        // until replaced or deleted, so this bucket has no lifecycle rule.
        PROFILES: bindings.r2({ name: own.profiles, jurisdiction: "eu" }),
        // Cloudflare Images re-encodes every profile photo to one size of WebP
        // without metadata (decision 0039). It transforms and keeps nothing.
        IMAGES: bindings.images(),
        // A DO namespace has no jurisdiction of its own: each object id is
        // pinned with `.jurisdiction("eu")` in src/env/, the only place stubs
        // are made.
        CONVERSATION: bindings.durableObject({ worker: own.worker, exportName: "Conversation" }),
        INBOX: bindings.durableObject({ worker: own.worker, exportName: "Inbox" }),
        // One per community: its posts, comments and reactions (decisions 0060, 0065).
        SPACE: bindings.durableObject({ worker: own.worker, exportName: "Space" }),
        // Workers rate limits. Each is counted per Cloudflare location, so it is
        // a brake on abuse, not an exact quota. PUBLIC_LIMIT is per address on
        // the routes a person reaches before signing in; CLAIM_LIMIT is per
        // account on key-package claims, which spend another account's
        // packages. PHOTO_LIMIT is per account on profile photo uploads
        // (decision 0039). A namespace is unique within the Cloudflare account;
        PUBLIC_LIMIT: bindings.rateLimit({
          namespace: own.limits.public,
          simple: { limit: 30, period: 60 },
        }),
        CLAIM_LIMIT: bindings.rateLimit({
          namespace: own.limits.claim,
          simple: { limit: 120, period: 60 },
        }),
        PHOTO_LIMIT: bindings.rateLimit({
          namespace: own.limits.photo,
          simple: { limit: 10, period: 60 },
        }),
        // The key of the kennitala HMAC (decisions 0014, 0019). Declared because
        // `cf dev` hands a Worker only the .dev.vars entries named here; a deploy
        // then requires it to be set, which it always is.
        KENNITALA_HMAC_KEY: bindings.secret(),
        // What a request must show to reach staging at all (dev/staging-app.ts),
        // declared so a staging deploy cannot go out without it.
        ...(mode === "staging" && { STAGING_GATE: bindings.secret() }),
        // The other secrets, set by `node tooling/worker-secrets.mjs` and never in
        // this file. They are not declared, so a deploy does not wait for them:
        //   KENNITALA_HMAC_KEY_PREVIOUS  the key before it, only while a rotation runs
        //   KENNI_CLIENT_SECRET  only if Kenni ever issues a confidential client
        //   KENNI_WEB_CLIENT_SECRET the Kenni web client's secret (decision 0062)
        //   GOOGLE_CLIENT_SECRET the Google web client's secret (decision 0033)
        //   FCM_SERVICE_ACCOUNT  the FCM service account's JSON key (decision 0025)
        //   APNS_KEY_P8          the APNs auth key (.p8), and APNS_KEY_ID its key id
        //   OPS_TOKEN            the maintainer's token for /ops (decision 0068)
        // Staging sets none of them (`jurisdiction-check.mjs`, docs/operations.md).
      },
      // Durable Object classes, declared (decision 0032). Conversation and Inbox
      // were created as sqlite classes under the old `migrations` tag v1 and were
      // moved to exports with their namespaces unchanged; there is no way back.
      // Space is new with decision 0065.
      exports: {
        Conversation: exports.durableObject({ storage: "sqlite" }),
        Inbox: exports.durableObject({ storage: "sqlite" }),
        Space: exports.durableObject({ storage: "sqlite" }),
      },
    },
  };
});
