# Push Notification Setup (attach later)

The architecture is complete. Push stays **off** until you do the steps below. While off:
- the app never asks for notification permission and never registers a device
  (`registerPushNotificationToken` returns `not_configured`),
- `dispatch-push` answers `503 push_not_configured` if its secrets are missing,
- a provider credential error never deactivates a device (only `DeviceNotRegistered` does).

## Steps, in order

1. **Decide the package ID first** (`docs/RELEASE_DECISIONS.md`). Firebase ties the Android app to it.
2. **Firebase:** create a project, add an Android app with that package ID, download `google-services.json`.
3. **Put the file in the build** (it is gitignored, never commit it), either:
   - local: copy it to `mobile/google-services.json`, or
   - EAS: `eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production`
   `mobile/app.config.js` adds `android.googleServicesFile` only when the file exists.
4. **EAS credentials:** upload the Firebase FCM V1 service account key (`eas credentials`, Android, Google Service Account Key for FCM V1).
5. **Server:** set `PUSH_DISPATCH_SECRET`, deploy `dispatch-push`, and schedule it with `pg_cron`
   exactly as in `docs/DEPLOYMENT_RUNBOOK.md` (section on the dispatch worker). Use the same secret in
   the Edge Function secret and Vault.
6. **Turn it on:** set `EXPO_PUBLIC_FEATURE_PUSH=true` in the EAS production environment and rebuild.

## Check it works
Install the new build on a physical Android phone, sign in, accept the permission, and trigger a
match or message from a second account. Inspect `notification_deliveries` (status, `last_error`).
Emulators cannot receive real pushes.
