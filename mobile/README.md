# iodriven mobile app

Expo + React Native + TypeScript, built for Android first; iOS builds from the same code later.
Design rules: `docs/design/DESIGN.md` §15. Shared API types and helpers: `packages/shared`.

**Status:** Phase 0 (scaffold). The one screen checks that the build reaches its API. Sign-in,
devices and dashboards come in Phase 1.

## Requirements

- **Node ≥ 22.13** (Expo SDK 58). The web app still runs on Node 20 in Docker; only the mobile
  tooling needs 22.
- pnpm 9 (the repo's workspace: run `pnpm install` from the repo root or any package).
- To run on a phone: a **development build** of the app installed on it (below). Expo Go can't
  load this app, because it carries native modules from Phase 2 on.

## Configuration

`EXPO_PUBLIC_API_URL` is the API the app talks to, inlined at build time:

| Where | Value |
|---|---|
| `mobile/.env` (local runs; copy `.env.example`) | `http://localhost:8000` |
| `eas.json` → `development` | `http://localhost:8000` |
| `eas.json` → `preview`, `production` | `https://api.iodriven.tech` |

With a phone on USB, forward the API port so `localhost` on the phone reaches this computer:

```bash
adb reverse tcp:8000 tcp:8000
```

## Builds (EAS)

Builds run on Expo's servers (EAS Build), so no Android SDK is needed here. They need an Expo
account, logged in with `npx eas-cli login`.

| Profile | What it is | Command |
|---|---|---|
| `development` | Dev client: loads the JavaScript from `pnpm start` on this computer, with live reload | `npx eas-cli build -p android --profile development` |
| `preview` | The standalone app against production, as an installable APK | `npx eas-cli build -p android --profile preview` |
| `production` | Play Store bundle (AAB), version auto-incremented | `npx eas-cli build -p android --profile production` |

EAS gives a link and QR to download the APK; on the phone, allow installs from that source once.
EAS creates and keeps the Android signing key; the Play Store uses the same one later.

## Develop

```bash
cd mobile
pnpm start          # Metro for the development build (scan its QR in the dev client)
pnpm typecheck
pnpm lint
pnpm test           # Jest (jest-expo); also checks tokens against the web's globals.css
pnpm doctor         # expo-doctor: SDK and config checks
```

`android/` and `ios/` are generated (Continuous Native Generation) and git-ignored:
`app.config.ts` is the source of truth.

## iOS-readiness rules

- Use only libraries that support Android and iOS.
- Keep Android-only code behind `Platform.OS === "android"`.
- Add each permission's iOS usage string in `app.config.ts` when the permission is added.
