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

export default defineConfig(({ mode }) => ({
  accountId: "af4d4a9c4527ce1e46d0c2dc1165e801",
  worker: {
    name: "spjall-api",
    compatibilityDate: "2026-08-22",
    // `cf dev --mode interop` runs dev/worker.ts, the real Worker plus a fake
    // Kenni, for the interop test (interop.yml). Every other mode, and every
    // deploy, runs src/index.ts; `jurisdiction-check.mjs` holds that.
    entrypoint: mode === "interop" ? "dev/worker.ts" : "src/index.ts",
    observability: { enabled: true },
    // The Worker answers only on the frozen API host (ids.json hosts.api), as
    // a custom domain on the samtak.is zone; workers.dev stays off so there is
    // one public address. `jurisdiction-check.mjs --deploy` holds both.
    domains: ["spjall.samtak.is"],
    workersDev: false,
    // Once a day the Worker deletes media past its 30 days (decision 0023). An
    // R2 lifecycle rule on spjall-media is the backstop, made with the bucket
    // (backend/README.md).
    triggers: [triggers.scheduled({ schedule: "17 3 * * *" })],
    // Read only through src/env/ (tooling/seam-guard.mjs).
    env: {
      // The oldest client build that may talk to this Worker, per platform.
      // Raised when a protocol change would break older builds; the apps read
      // it from /health and ask the user to update.
      MIN_CLIENT_VERSION_ANDROID: bindings.text("0.2.0"),
      MIN_CLIENT_VERSION_IOS: bindings.text("0.2.0"),
      // Kenni's issuer for this Samtak team (decision 0019). The Worker reads
      // its discovery document; the apps get the authorize endpoint from
      // /v1/sign-in. The interop run signs in with dev/worker.ts's fake Kenni.
      KENNI_ISSUER: bindings.text(
        mode === "interop"
          ? "http://127.0.0.1:8787/dev/kenni"
          : "https://idp.kenni.is/innskraning.is",
      ),
      // Google, the first way to sign in (decision 0033): its issuer, and the
      // web client the consent screen belongs to. The client id is not a
      // frozen id; the apps get it from /v1/sign-in. Left empty, Google sign-in
      // answers 503 and Kenni still works. The interop run signs in with
      // dev/worker.ts's fake Google.
      GOOGLE_ISSUER: bindings.text(
        mode === "interop" ? "http://127.0.0.1:8787/dev/google" : "https://accounts.google.com",
      ),
      GOOGLE_CLIENT_ID: bindings.text(
        mode === "interop"
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
      APNS_TEAM_ID: bindings.text("B4724Z74TM"),
      APNS_TOPIC: bindings.text("is.samtak.spjall.beta"),
      // Migrations are backend/migrations/, applied by
      // `cf d1 migrations apply <id> --dir migrations` (scripts/d1.ts).
      DB: bindings.d1({ name: "spjall-db", id: "7d38bae5-7ee1-4ff4-af95-49a1afbbdbbb" }),
      MEDIA: bindings.r2({ name: "spjall-media", jurisdiction: "eu" }),
      // Profile photos (decision 0039): one re-encoded WebP per account, kept
      // until replaced or deleted, so this bucket has no lifecycle rule.
      PROFILES: bindings.r2({ name: "spjall-profiles", jurisdiction: "eu" }),
      // Cloudflare Images re-encodes every profile photo to one size of WebP
      // without metadata (decision 0039). It transforms and keeps nothing.
      IMAGES: bindings.images(),
      // A DO namespace has no jurisdiction of its own: each object id is
      // pinned with `.jurisdiction("eu")` in src/env/, the only place stubs
      // are made.
      CONVERSATION: bindings.durableObject({ worker: "spjall-api", exportName: "Conversation" }),
      INBOX: bindings.durableObject({ worker: "spjall-api", exportName: "Inbox" }),
      // Workers rate limits. Each is counted per Cloudflare location, so it is
      // a brake on abuse, not an exact quota. PUBLIC_LIMIT is per address on
      // the routes a person reaches before signing in; CLAIM_LIMIT is per
      // account on key-package claims, which spend another account's
      // packages. POST_LIMIT is per account on posts and replies to Fljótið
      // (decision 0034); PHOTO_LIMIT is per account on profile photo uploads
      // (decision 0039). A namespace is unique within the Cloudflare account.
      PUBLIC_LIMIT: bindings.rateLimit({ namespace: "1001", simple: { limit: 30, period: 60 } }),
      CLAIM_LIMIT: bindings.rateLimit({ namespace: "1002", simple: { limit: 120, period: 60 } }),
      POST_LIMIT: bindings.rateLimit({ namespace: "1003", simple: { limit: 20, period: 60 } }),
      PHOTO_LIMIT: bindings.rateLimit({ namespace: "1004", simple: { limit: 10, period: 60 } }),
      // Secrets, set by `node tooling/worker-secrets.mjs`, never in this file:
      //   KENNITALA_HMAC_KEY   the key of the kennitala HMAC (decisions 0014, 0019)
      //   KENNITALA_HMAC_KEY_PREVIOUS  the key before it, only while a rotation runs
      //   KENNI_CLIENT_SECRET  only if Kenni ever issues a confidential client
      //   GOOGLE_CLIENT_SECRET the Google web client's secret (decision 0033)
      //   FCM_SERVICE_ACCOUNT  the FCM service account's JSON key (decision 0025)
      //   APNS_KEY_P8          the APNs auth key (.p8), and APNS_KEY_ID its key id
    },
    // Durable Object classes, declared (decision 0032). Both were created as
    // sqlite classes under the old `migrations` tag v1 and were moved to
    // exports with their namespaces unchanged; there is no way back.
    exports: {
      Conversation: exports.durableObject({ storage: "sqlite" }),
      Inbox: exports.durableObject({ storage: "sqlite" }),
    },
  },
}));
