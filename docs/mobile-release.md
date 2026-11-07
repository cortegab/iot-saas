# Releasing the mobile app (Android)

How a version of the IO Driven app gets from the repo to phones: test APKs on GitHub Releases now,
and the **Play Store internal testing track** next. Building is covered in `mobile/README.md`.

## Every release

1. **Version:** bump `VERSION` in `mobile/app.config.ts` (and `mobile/package.json`). Android's
   `versionCode` and iOS's `buildNumber` follow it (1.2.3 → 10203); never edit them by hand.
2. **Checks:** in `mobile/`, `pnpm typecheck && pnpm lint && pnpm test`. If a native library was
   added or changed, test a **release** build on a phone. R8 minification only runs there (see
   "R8" in the README); `MINIFY=0 pnpm build:apk` builds one without it, to compare.
3. **Build:** `pnpm build:aab` for Play, `pnpm build:apk` for a test APK. Both need
   `~/.config/iodriven/google-services.json` (push), and Play builds need the upload key in
   `mobile/credentials/`.
4. **Check the artifact:** `aapt2 dump badging` shows the expected `versionName` / `versionCode`;
   install the APK on a phone; sign in; scan a QR; open Alerts.
5. **Publish:** upload the AAB to the internal testing track (below), or attach the APK to a GitHub
   pre-release `mobile-v<version>`. Publishing is public: the owner approves each one.
6. **Server:** set `LATEST_MOBILE_VERSION` on the API. Raise `MIN_MOBILE_VERSION` only if an API
   change breaks older apps; older apps then show **Update required** and link to
   `MOBILE_UPDATE_URL` (`/meta/client`). The API otherwise changes additively, so old apps keep
   working.

## First Play release (one time, by the owner)

1. **Upload key:** `cd mobile && pnpm upload-key`. Back up both files in `mobile/credentials/`.
   The password is generated and never printed.
2. **Play Console** (a Google Play developer account): Create app → name **IO Driven**, app,
   free. Package `tech.iodriven.app`.
3. **Play App Signing:** accept Google-managed signing; upload the AAB built with the upload key.
4. **App Links:** copy the **app signing key** SHA-256 (Play Console → Setup → App integrity) and
   the upload key's (`keytool -list -v -keystore mobile/credentials/upload.keystore`) into the
   server's `ANDROID_APP_CERT_SHA256`, comma-separated, so device-label links open in the app.
5. **Store listing:**
   - short description: "Watch, control and set up your IoT devices from your phone.";
   - icon `mobile/store/icon-512.png`, feature graphic `mobile/store/feature-graphic.png`;
   - 2–8 phone screenshots (a dashboard, a device, Alerts, Set up Wi-Fi), taken from a test
     workspace, not a customer's;
   - privacy policy URL **https://iodriven.tech/privacy**.
6. **App access:** the app needs an account. Give Google a test account in a test workspace (never a
   real customer's), with a device that reports.
7. **Content rating:** questionnaire → a utility app with no user-generated public content: "Everyone".
8. **Data safety:** see below.
9. **Internal testing:** create a release with the AAB, add testers' emails, share the opt-in link.

## Data safety answers

From what the app and platform actually do (`/privacy`, `docs/mobile-push.md`):

| Question | Answer |
|---|---|
| Collects or shares user data? | Collects: yes. Shares: no. Google FCM delivering notifications is a service provider, which isn't "sharing". |
| Encrypted in transit? | Yes (HTTPS / MQTT over TLS). |
| Users can request deletion? | Yes, via "Talk to us" on iodriven.tech (`/privacy`). |
| **Personal info → Name, Email address** | Collected; required; for **App functionality** and **Account management**. |
| **App activity → Other actions** (rules, commands, dashboards) | Collected; required; **App functionality**. |
| **Device or other IDs** (the FCM push token) | Collected; optional (only if alerts are turned on); **App functionality**. |
| Location | Not collected. On Android 11 and older the Bluetooth scan needs the location permission, but no location is read or sent. |
| Photos / videos (camera) | Not collected: QR frames are processed on the phone. |
| Advertising / analytics | None. |

Telemetry from the customer's IoT devices belongs to the customer's workspace, not to the phone's
user; it isn't data the app collects from the user.

## Test releases (now)

Until Play: `pnpm build:apk` (debug-signed unless the upload key exists) and a GitHub pre-release
`mobile-v<version>`. Phones install it over earlier test builds. Switching to the upload key
signature means uninstalling the debug-signed app once.
