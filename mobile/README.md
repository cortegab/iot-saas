# IO Driven mobile app

Expo + React Native + TypeScript, built for Android first; iOS builds from the same code later.
Design rules: `docs/design/DESIGN.md` §15. Shared API types and helpers: `packages/shared`.

**Status:** Phase 2 (0.3.0): sign-in, workspaces, devices with live readings and trends,
dashboards, **Scan** (device labels and Wi-Fi setup QRs) and **Wi-Fi setup over Bluetooth**
(`docs/ble-provisioning.md`, "The IO Driven app"). Phase 3 adds actuator controls (0.4.0); alerts and rules follow.

Bluetooth and the camera need a real phone: there's no BLE in an emulator.

Builds run **on this machine** with Gradle; no Expo account is needed. (`eas.json` is kept for the
option of Expo's cloud builds later, for example for iOS without a Mac.)

## One-time setup (Linux / WSL, no root needed)

| Tool | Where | Notes |
|---|---|---|
| Node ≥ 22.13 | nvm (`~/.nvm`), default `22` | Expo SDK 58 needs it; the web's Docker images keep Node 20 |
| pnpm 9 | corepack | The repo's workspace: `pnpm install` from any package |
| JDK 17 | Eclipse Temurin in `~/.local/share/jdk-17` | `JAVA_HOME` |
| Android SDK | `~/Android/Sdk` (`ANDROID_HOME`) | cmdline-tools, platform-tools, `platforms/android-37.0`, `build-tools/37.0.0`, `ndk/27.1.12297006`; versions come from React Native (`node_modules/react-native/gradle/libs.versions.toml`) |
| Gradle memory | `~/.gradle/gradle.properties` | `org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g` |

`~/.bashrc` sets `JAVA_HOME`, `ANDROID_HOME` and adds the JDK, `cmdline-tools/latest/bin` and
`platform-tools` to `PATH`. Install a missing SDK package with `sdkmanager --install "<name>"`
(this cmdline-tools version names packages with `/`, e.g. `platforms/android-37.0`).

## Configuration

`EXPO_PUBLIC_API_URL` is the API the app talks to, inlined into the JavaScript bundle:

| Build | File | Value |
|---|---|---|
| Local development (`pnpm start`) | `mobile/.env` (copy `.env.example`; git-ignored) | `http://localhost:8000` |
| Release builds (`build:apk`, `build:aab`) | `mobile/.env.production` (committed) | `https://api.iodriven.tech` |

To build a release against another API, set it for that run:
`EXPO_PUBLIC_API_URL=http://10.0.0.5:8000 pnpm build:apk`.

## Build

```bash
cd mobile
pnpm build:apk      # installable APK (arm64 + armv7 phones)
pnpm build:aab      # Play Store bundle (every architecture; Play delivers the right one)
```

Each runs `expo prebuild --clean` (regenerating `android/` from `app.config.ts`, git-ignored),
then Gradle. Outputs:

- `android/app/build/outputs/apk/release/app-release.apk`
- `android/app/build/outputs/bundle/release/app-release.aab`

The first build takes about half an hour (downloads and native compiles); later ones reuse the
caches.

### Signing

Release builds sign with the **Play upload key** when `mobile/credentials/` holds it, and with the
debug key otherwise (fine for test APKs, refused by the Play Store). Create it once:

```bash
pnpm upload-key     # scripts/create-upload-key.sh
```

It writes `credentials/upload.keystore` and `credentials/upload-key.properties`, with a generated
password that is never printed. The folder is git-ignored. **Back up both files** (a password
manager's attachments work): with Play App Signing, Google holds the app's signing key, and a lost
upload key can be reset through Play Console, but only after a wait. The signing is added by
`plugins/with-upload-signing.js`, because `android/` is regenerated on every build.

## Install on a phone

WSL doesn't see USB devices by default. Either:

- **Copy the APK** to the phone (Drive, USB file transfer, email) and open it; allow installs from
  that source once. Installing a newer APK over it keeps the app's data.
- **Wireless debugging** (Android 11+): Developer options → Wireless debugging → Pair device with
  pairing code, then from WSL `adb pair <ip>:<port>` and `adb connect <ip>:<port>`, and
  `adb install -r android/app/build/outputs/apk/release/app-release.apk`.

An APK signed with one key can't be updated by an APK signed with another: after switching from the
debug key to the upload key, uninstall the test app first.

## Develop

```bash
cd mobile
pnpm start          # Metro for a development build (expo run:android installs one over adb)
pnpm typecheck
pnpm lint
pnpm test           # Jest (jest-expo); also checks tokens against the web's globals.css
pnpm doctor         # expo-doctor: SDK and config checks
```

## Publishing (later)

- **Play Store:** a Google Play Console developer account; upload the AAB to the internal testing
  track first.
- **App Store:** iOS builds need a Mac with Xcode (or a cloud build service), and an Apple
  Developer Program membership.

## iOS-readiness rules

- Use only libraries that support Android and iOS.
- Keep Android-only code behind `Platform.OS === "android"`.
- Add each permission's iOS usage string in `app.config.ts` when the permission is added.
