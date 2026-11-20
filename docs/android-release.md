# Android release checklist

Shuttler ships to Android from the same Expo codebase as iOS. The `android/`
native project is **not committed**: EAS generates it from `app.config.ts` on
every build (`expo prebuild`). Make Android changes in `app.config.ts`, never in
a generated `android/` folder.

Package name: `com.shuttler.app`

---

## 1. Google Play developer account (one-time)

- [ ] Create a Play Console account as an **organization** under Tebet LLC
      (one-time $25; needs a D-U-N-S number). Organization accounts are exempt
      from the 12-tester / 14-day closed-test requirement that applies to new
      personal accounts.
- [ ] Create the app in Play Console (default language, app name "Shuttler",
      app, free).

## 2. Firebase Android app → push notifications (FCM)

Android push notifications are delivered through FCM. Without these steps,
stop-request notifications will not reach Android drivers.

- [ ] Firebase console → project `shuttler-8f030` → Add app → Android →
      package `com.shuttler.app`. Download `google-services.json`.
- [ ] Upload it to EAS as a secret file env var (it's gitignored, so EAS can't
      read it from the repo):

      eas env:create --name GOOGLE_SERVICES_JSON --type file \
        --value ./google-services.json --visibility secret \
        --environment production --environment preview --environment development

      For local `expo run:android`, keep a copy at the repo root.
- [ ] Firebase console → Project settings → Service accounts → Generate new
      private key. Then `eas credentials` → Android → production →
      Google Service Account → **Push Notifications (FCM V1)** → upload that key.

## 3. First build and signing

- [ ] `eas build -p android --profile production` — let EAS generate and manage
      the upload keystore.
- [ ] Upload that first `.aab` **by hand** in Play Console → Testing → Internal
      testing (Google's API rejects an app's very first upload). Accept
      **Play App Signing** when prompted.
- [ ] After that, `npm run deploy:android` builds and submits to the internal
      track as a draft automatically. That needs a Play service account:
      Google Cloud → create a service account → JSON key → save as
      `play-service-account.json` at the repo root (gitignored), and grant it
      access in Play Console → Users and permissions.

For quick device testing without the store: `eas build -p android --profile preview`
produces an installable `.apk`.

## 4. SHA-1 fingerprints → Google Sign-In and Maps

Collect two SHA-1s:
- **App signing key** — Play Console → Test and release → App integrity.
- **Upload key** — `eas credentials` → Android → production (also signs
  preview APKs).

Then:
- [ ] **Google Sign-In:** Google Cloud console (project linked to Firebase) →
      Credentials → Create OAuth client ID → Android → package
      `com.shuttler.app` + app-signing SHA-1. Create a second Android client with
      the upload SHA-1 if Google sign-in should work in preview APKs.
- [ ] Add the client ID to `eas.json` → `build.production.env`:
      `"EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID": "<id>.apps.googleusercontent.com"`
- [ ] **Maps:** create an Android-only Maps SDK key restricted to
      `com.shuttler.app` + both SHA-1s, and add it as
      `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY` in `eas.json` production env.
      (Until set, the shared `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is used.) The
      shared key is still needed for the Directions/Places REST calls made from
      JS — restrict that one by **API**, not by app.

## 5. Play Console store listing and policy

- [ ] Store listing: short/full description, phone screenshots, 512×512 icon,
      1024×500 feature graphic (reuse copy from `docs/app-store-listing.md`).
- [ ] Privacy policy URL.
- [ ] **Data safety** form: precise location (riders and drivers), name, email,
      phone number, user IDs; data encrypted in transit; account deletion
      available.
- [ ] **Account deletion** URL (Play requires a web link, not only in-app).
- [ ] Content rating questionnaire, target audience (not aimed at children),
      ads: none.
- [ ] **Location permissions declaration** — required while the app requests
      `ACCESS_BACKGROUND_LOCATION`. Decide in the driver-tracking work (phase 2)
      whether a foreground service with while-in-use permission is enough; if
      so, remove `ACCESS_BACKGROUND_LOCATION` from `app.config.ts` and this
      declaration goes away.
- [ ] Payments: billing happens on shuttler.net via Stripe for organizations
      (B2B). Confirm this against Google Play's Payments policy before
      production review.
- [ ] Reviewer access: add demo credentials under App content → App access
      (see `docs/app-store-reviewer-notes.md`).

## 6. Before promoting to production

- [ ] Test on at least a Pixel and a Samsung device (Samsung's battery
      optimisation is the most aggressive at killing background location).
- [ ] Driver shift with screen locked for 10+ minutes — rider map keeps updating.
- [ ] Stop-request push arrives with the custom sound (channel `stop-requests`).
- [ ] Google sign-in, email sign-in, phone verification, SSO deep link
      (`shuttler://sso`).
- [ ] Stripe upgrade flow opens the browser and returns to the app.
