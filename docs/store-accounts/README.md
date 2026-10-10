# Store accounts for Samtak svf.

Decision: [0010](../decisions/0010-samtak-own-store-accounts.md). Every step here is
the maintainer's: each one pays money, signs for the organisation or creates something that cannot
be undone. Agents prepare, they do not submit.

The lessons below come from earlier 2026 enrollments of other apps.

## Status

| Step            | State                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-U-N-S         | `500780159`. D&B already held Samtak svf., Gullengi 37, Reykjavik 112, so nothing was filed; Apple's lookup found it and emailed the number to `samtak@samtak.is` (2026-10-05).                                                              |
| Play Console    | Organization account `Samtak`, id `7834777154486168621`, owner `samtak@samtak.is`, fee paid 2026-10-05. Payments profile on the D&B record; website verified. Identity submitted 2026-10-05, in review; phone verification follows approval. |
| Apple Developer | Not started. The Account Holder Apple ID is still to be chosen.                                                                                                                                                                              |

## Order

1. D-U-N-S number for Samtak svf. (free, a few days).
2. In parallel, once the D-U-N-S is confirmed:
   - Google Play Console (about a day).
   - Apple Developer Program (about four weeks).
3. After both: register the app ids (§ After enrollment).

## 1. D-U-N-S

Look it up through Apple's D-U-N-S lookup (developer.apple.com/enroll/duns-lookup). If D&B
already holds the organisation, Apple emails the number at once; if not, the same page files a
free request with Dun & Bradstreet. For Samtak svf. the record existed (Status above).

| Field             | Value                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| Legal entity name | `Samtak svf.` (already ASCII; type it exactly as in the RSK extract)     |
| Legal form        | samvinnufélag (cooperative, svf.)                                        |
| Registration no.  | the kennitala on the fyrirtækjaskrá extract (kept out of git, 0008)      |
| Address           | the registered address on the extract, in ASCII (`ð` → `d`, `ö` → `o` …) |
| Postcode          | four characters on Apple's form: `0112` for 112                          |
| Contact email     | `samtak@samtak.is`                                                       |
| Website           | `https://samtak.is`                                                      |

**Write every organisation field in ASCII**, using the ISNIC mapping (`þ` → `th`, `æ` → `ae`,
accents dropped). In 2026-05 Apple's verification webform rejected the accented legal name
with a misleading error on another field. The name Apple checks is the one D&B holds, so it
must be identical in the D-U-N-S request, the Apple form and the Play form.

## 2. Google Play Console

- **Account type:** Organization, and on the signup page choose **A nonprofit**: 2. gr. of the
  samþykktir says the félag is not run for profit (ekki rekið í hagnaðarskyni). The
  requirements are the same as for a company, D-U-N-S included.
  Sign in as `samtak@samtak.is` before starting: the signed-in account becomes the owner,
  and **the owner can never be changed**. Add people as users afterwards.
- **The owner account, first:** create it at accounts.google.com/signup with "Use your existing
  email" and `samtak@samtak.is`. Before the signup, give it two-step verification and a way
  back in that does not depend on mail, kept outside the repo (decision 0010).
- **Contact email:** `samtak@samtak.is`.
- **Payments profile:** create a new one with the D&B name and address. Do not reuse an
  older profile under another name.
- **Fee:** USD 25, once. No waiver.
- **D-U-N-S:** the number from step 1. Name and address fill in from D&B.
- **Website verification:** `samtak@samtak.is` owns the Search Console domain property
  `samtak.is`, verified by the apex TXT record `google-site-verification=…` on Cloudflare
  (comment "Never delete"). Because the Play owner is also the Search Console owner, Play
  marked the website verified without a separate approval. Never delete the record; Google
  rechecks.
- **Identity documents:** the organisation step takes the RSK certificate (_vottorð úr
  fyrirtækjaskrá_) naming the framkvæmdastjóri. The authorised-representative step first
  hands off to a phone; "Try another way" → "Continue on this device" allows uploading the
  identity document as files.
- **Postcode quirk:** where Play asks for an address by hand, the field appends to what is
  there (`IS 0101101`). Click it, Ctrl+A, Delete, then type the postcode. Samtak's signup did
  not hit it: the address came from D&B as `Reykjavik - 112`.
- **Other accounts:** "About you" asks for Google accounts used in Play Console in the past
  six months; the maintainer's own account is declared and verified.
- **After approval:** register the package name `is.samtak.spjall` under Android developer
  verification. It shows as Draft first, then Registered.

## 3. Apple Developer Program

- **Fee:** USD 99 a year.
- **Account Holder:** the Apple ID that enrolls. Two-factor sign-in is required. Only the
  Account Holder can accept agreements, which matters later (below).
- **The form:** ASCII in every organisation field, the D-U-N-S, the legal contact who can sign
  for Samtak svf. Note the enrollment ID Apple shows.
- **The authority letter:** about two weeks in, Apple support asks for a letter on the
  organisation's letterhead. The template is
  [`apple-authority-letter.md`](apple-authority-letter.md). The framkvæmdastjóri and the
  formaður sign it with a Dokobit QES (eIDAS qualified signature), and it is uploaded at
  developer.apple.com/contact/file-upload. Upload notes can be lost, so reply to the support
  email as well.
- **Verification webform:** Apple emails a webform after the documents are approved. Its
  one-time code goes to the **legal contact's** email, not the applicant's. ASCII again.
- **Program License Agreement:** arrives about a week later. The Account Holder accepts it in
  the developer account; then the team is Active and has a team id.

**When an agreement is missing,** every App Store Connect API call returns
`403 FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED` without naming the agreement. Only the
Account Holder can fix it, by accepting whatever is pending in the developer account
(2026-07-14).

### Interim: TestFlight on an existing team (decision 0011)

An Apple ID can be Account Holder of one membership only, so the Apple ID that holds the
existing team `B4724Z74TM` cannot enroll Samtak svf. Apple's web form refused a new Apple ID
for `samtak@samtak.is` on 2026-10-05 ("Your account cannot be created at this time"); the
next try is from an Apple device. Until the team exists:

- TestFlight builds run on `B4724Z74TM` under the interim ids in `appleInterim`
  (`is.samtak.spjall.beta`, `.beta.notifications`, `group.is.samtak.spjall.beta`). The frozen
  ids are never registered there: a TestFlight-only app cannot be transferred between teams.
- The team's Distribution certificate and App Store Connect API key are scoped to the team, so
  they live only in the `testflight` environment, never in repo secrets:
  `IOS_SIGNING_P12_BASE64`, `IOS_SIGNING_P12_PASSWORD`, `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`
  and `ASC_API_KEY_P8`, set from the maintainer's vault.
- The bundle ids and the App Store profiles are created through the App Store Connect API.
  The profiles are named `<bundle id> appstore`, the names `ios/Generated/IdsInterim.xcconfig`
  expects. The App Group and its assignment to both ids, and the app record, are web UI only.
- `ios-testflight.yml` (manual) builds the `Interim` configuration and uploads it. Each run
  waits for the maintainer to approve the `testflight` environment.
- Testers are in the internal group "Prufuflug", which has access to every build, so a new
  build needs no assignment (App Store Connect refuses one for an internal group with 422).
  Add a tester by email: `POST /v1/betaTesters` with the email and the group. Linking an
  existing tester record to the group answers 409 "Tester(s) cannot be assigned".
- App Store Connect reports a refused upload under `/v1/apps/{id}/buildUploads` (state
  `FAILED`, with the error codes), while the upload step can keep waiting. That endpoint takes
  no `sort`.

## After enrollment

**Apple**, in this order:

1. Put the team id in `identifiers/ids.json` and `ids.lock.json` in one PR citing 0010.
2. Register the App ID `is.samtak.spjall`, the NSE `is.samtak.spjall.notifications` and the
   App Group `group.is.samtak.spjall`.
3. Create the APNs key, a Distribution certificate and an App Store Connect API key. The app
   record itself is created in the web UI; the API cannot create it.
4. Store the secrets in `samtak-secrets` as `samtak-spjall-apns-key`,
   `samtak-spjall-ios-signing-p12`, `samtak-spjall-asc-api-key` (raw PEM, not base64).

**Google**, once the identity check is approved. `.github/workflows/android-play.yml` builds,
signs and uploads to internal testing; it fails at its first step until these exist.

1. Create the app `is.samtak.spjall` (default language Icelandic) and set up the internal
   testing track with a tester list. Turn on Play App Signing (the default): Google holds the
   app signing key, and the workflow signs with an upload key only.
2. Generate the upload keystore:
   `keytool -genkeypair -keystore upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`.
   Store it (base64), its passwords and the alias in `samtak-secrets` as
   `samtak-spjall-android-upload-keystore`, `-android-upload-store-password`,
   `-android-upload-key-alias` and `-android-upload-key-password`.
3. In Google Cloud project `samtak-spjall`, enable the Google Play Android Developer API and
   create the service account `spjall-play` with one JSON key, stored as
   `samtak-spjall-play-service-account`. In Play Console, Users and permissions, invite its
   email with the app's "Release to testing tracks" permission only.
4. In GitHub, create the environment `play` with the maintainer as required reviewer and
   these secrets: `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_STORE_PASSWORD`,
   `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD`, `ANDROID_GOOGLE_SERVICES_JSON`
   (from `samtak-spjall-android-google-services`) and `PLAY_SERVICE_ACCOUNT_JSON`.
5. The API refuses the first bundle of a new app, so the first one goes up by hand: run
   `android-play` with `upload: false`, download its `app-release` artifact and upload it to
   internal testing in Play Console. Every later run uploads by itself.

## Push credentials (decision 0025)

**FCM**, on the Firebase project `samtak-spjall` in `samtak-org`, owned by `samtak@samtak.is`.
Steps 1 to 3 were done on 2026-10-08: the project is on the Spark plan with no Analytics, the
key-creation policy is overridden (not enforced) on this project only, and the service account
has one user-managed key. Step 4 waits for the Worker.

1. Create the project with the id `samtak-spjall` (the frozen `firebaseProjectId`), parent
   `samtak-org`, Google Analytics off. Accepting the Firebase terms is the maintainer's.
2. Add the Android app `is.samtak.spjall`. Download `google-services.json` into
   `android/app/` (git-ignored; the build checks its `project_id` against `ids.json`) and
   store it as `samtak-spjall-android-google-services`.
3. Enable `fcm.googleapis.com`. Create the service account `spjall-fcm`, give it only
   `roles/firebasecloudmessaging.admin` on the project, make one JSON key and store it as
   `samtak-spjall-fcm-service-account`. If the org policy
   `iam.disableServiceAccountKeyCreation` blocks the key, lift it for this project only.
   Setting that override needs Organization Policy Administrator on `samtak-org`;
   Organization Administrator alone cannot.
4. After the Worker's first deploy, `node tooling/worker-secrets.mjs` copies it (and
   `KENNITALA_HMAC_KEY`) from the vault into the Worker; see `backend/README.md`.

**APNs** runs on the interim team for now (0011, "Push on the interim team"): the key is
on `B4724Z74TM`, `APNS_TOPIC` is `is.samtak.spjall.beta`, and the key is in the vault under
the names below. When Samtak svf.'s Apple team exists, after step 3 of Apple above:

1. Set `APNS_TEAM_ID` to the team id and `APNS_TOPIC` to `is.samtak.spjall` in
   `backend/wrangler.jsonc`. `App/Spjall.entitlements` already carries `aps-environment`.
2. Store the new key and its id as new versions of `samtak-spjall-apns-key` and
   `samtak-spjall-apns-key-id`, run `tooling/worker-secrets.mjs`, then revoke the interim key.

Neither store listing becomes public before the public release gate in 0009.
