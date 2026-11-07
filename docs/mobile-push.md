# Push notifications (mobile app)

New alerts reach the IO Driven app as push notifications through **Firebase Cloud Messaging
(HTTP v1)**, sent directly by the platform: no Expo push service in between.

## How it works

```
rule fires / device goes offline / delivery fails
  → notifications.service.create_notification   (row in `notifications`)
  → realtime event {"type":"notification","id"} on realtime:<tenant>   (already there for live updates)
  → worker push_loop (app.push.sender) picks it up, off the hot path
  → phones of current members that want this severity (`push_devices`)
  → FCM HTTP v1, one request per phone
```

- **Off the hot path.** The sender is its own worker loop listening on the realtime channels. Rule
  evaluation never waits for it (CLAUDE.md §9.1).
- **Best effort.** Redis pub/sub isn't durable: an alert raised while the worker is down isn't
  pushed later. It's always in the app's Alerts list.
- **Who receives.** Each registration has `min_severity`: `critical` (critical only) or `warning`
  (warnings and critical). Info (a rule cleared, a template changed) never pushes. Only current
  members of the workspace receive; a phone of someone who left is skipped.
- **Names only.** The payload carries the rule and device names and ids, never readings or the
  rule's own message text, because FCM relays it through Google. Titles: "{rule} fired",
  "{device} went offline", "{rule} can't evaluate", "A delivery failed for {rule}".
- **Repeats collapse.** The Android notification `tag` is `{kind}:{device or rule}`, so repeats of
  one alert replace each other on the phone. Critical alerts use the `critical` channel with high
  priority; the rest use `alerts`.
- **Gone phones.** When FCM answers `UNREGISTERED` (404) or an invalid registration token (400),
  the registration is deleted.

## API (signed-in users, per workspace)

| Method | Path | |
|---|---|---|
| `PUT` | `/me/push-devices` | Register this phone's FCM token (`token`, `platform`, optional `min_severity`, `enabled`). The same token again updates the same row, and moves it to this user. |
| `PATCH` | `/me/push-devices/{id}` | Change `min_severity` / `enabled`. |
| `DELETE` | `/me/push-devices/{id}` | Unregister (sign-out). |

A user only sees and changes their own phones. `push_devices` has `tenant_id` and the standard RLS
policy.

## Configuration

| Where | Setting |
|---|---|
| Firebase | Project `io-driven`, Android app `tech.iodriven.app`, **Cloud Messaging API (V1) enabled**. |
| App build | `google-services.json` for `tech.iodriven.app`, kept outside the repo (`~/.config/iodriven/`), copied into the build. |
| Backend | `FCM_SERVICE_ACCOUNT_FILE`: host path of the service-account JSON (Project settings → Service accounts → Generate new private key). The worker mounts it read-only at `/run/secrets/fcm-service-account.json`. Unset: push is off, and the worker logs it once. |

The service-account key is a secret: keep it outside the repo, `chmod 600`. To rotate it, delete
the old key in Google Cloud → IAM → Service accounts → Keys, create a new one, replace the file and
restart the worker.
