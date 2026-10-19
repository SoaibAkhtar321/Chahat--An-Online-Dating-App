# Release readiness (Chahat Phases 1-4, Android)

Status as of the Phase 4 branch. "Verified" means a command or test actually ran in a sandbox (Node 22,
disposable PostgreSQL 16, no Android SDK, no device, no Supabase/Google/Agora/Expo accounts). Everything else is
"not verified".

## Verified (automated)

| Check | Command | Result |
|---|---|---|
| Jest | `npx jest` | 678 tests pass; suite `__tests__/likesService.test.ts` fails to load (pre-existing `jest.mock` scoping error, same on `main`) |
| ESLint | `npm run lint` | clean |
| SQL suite (RLS, entitlements, calls, push, storage, deletion, concurrency) | `PGPORT=5433 bash supabase/tests/run.sh` on a disposable cluster | all pass |
| All 40 migrations apply in order to an empty database | psql loop with `ON_ERROR_STOP=1` | pass |
| Catalog audit | queries on a fully migrated DB | every `public` table has RLS; every `SECURITY DEFINER` function pins `search_path` and is not executable by `anon`; app tables grant `anon` nothing except `legal_document_versions` SELECT (after `...004000`) |
| Expo config / Android prebuild | `npx expo config --type public`, `npx expo prebuild --platform android --no-install` (output discarded) | succeeds; release manifest removes `SYSTEM_ALERT_WINDOW` |

## Not verified / failing

- `npm run build` (`tsc --noEmit`) fails with one error in `NotificationResponseHandler.tsx` (likes-access call typing). Present on `main`; not changed.
- `likesService.test.ts` (above).
- `npx expo-doctor`: reports mismatched versions (`expo-crypto`, `expo-device`, `expo-screen-capture` at 58.x on SDK 52, `react-native` 0.76.7 vs 0.76.9, async-storage 2.x). Run offline so unreliable; not changed (no dependency upgrades). Fix with `npx expo install --check` and a fresh build before release.
- Gradle/EAS release build, signing, install on a device: **not run** (no SDK/credentials).
- Edge Functions (`supabase/functions`) are exercised only through their pure-policy Jest tests; Deno is not installed, so the functions were not run.
- Google Play Billing purchase, renewal, expiry, cancel, refund against Google: **not run**. Server-side behaviour (expired/cancelled/revoked entitlement removes access) is covered by SQL tests 43, 57 and the entitlement tests; the Google API itself is not.
- Real push delivery, FCM, Realtime over the network, Agora tokens: **not run**.
- Android device matrix (foreground/background/killed/locked) for notifications and calls: **not run**. See the checklist below.

## Security findings (Phase 4)

Fixed:
1. `anon` held table-level privileges on `notification_preferences` (RLS still denied every row, so nothing was readable). Revoked by `20260101004000_phase4_revoke_anon_notification_preferences.sql`; regression in `supabase/tests/59_phase4_anon_grants.sql`.
2. Release manifest would have requested `SYSTEM_ALERT_WINDOW` (Expo default; unused; Play-policy sensitive). Now in `android.blockedPermissions`; asserted in `__tests__/callNotificationPolicy.test.ts`.

Reviewed, no change needed: Edge Function auth (`verify_jwt` on user-facing functions; `dispatch-push` uses a constant-time shared secret; Play RTDN verifies the Pub/Sub JWT), the client never grants a tier locally (it finishes a purchase only after `verify-purchase` succeeds and reads tier from the server), no service-role/Agora/Play secrets in `mobile/`, no committed `.env`/keystore/service-account files.

Open items (not fixed):
- `mobile/eas.json` `preview` profile hard-codes the Supabase URL and publishable key. The publishable key is designed to be public, but this ties preview builds to one project; prefer EAS environment variables.
- `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` are requested; confirm they are needed on your target SDK or block them.
- No `google-services.json` / `googleServicesFile`: Android push cannot work until it is added (`docs/PUSH_SETUP.md`).

## Release blockers

1. Apply migrations `...003800`, `...003900`, `...004000` to staging, then production, with approval; redeploy `dispatch-push`.
2. Provide Firebase `google-services.json` and an FCM V1 key in EAS.
3. Mobile call media adapter is not written; calls cannot connect (`EXPO_PUBLIC_FEATURE_CALLS` must stay off).
4. Fix `tsc` error and `likesService` test, align Expo dependency versions, then build a signed AAB.
5. Run the device checklist.

## Environment variables

Mobile (public, build-time): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and flags `EXPO_PUBLIC_FEATURE_BILLING|PUSH|CALLS|VOICE_MESSAGES|COIN_TOPUP` (only the exact value `true` enables).
Edge Function secrets (never in the app): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PUSH_DISPATCH_SECRET`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (or `_EMAIL` + `_PRIVATE_KEY`), `ANDROID_PACKAGE_NAME`, `PUBSUB_PUSH_AUDIENCE`, `PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL`, `CALL_PROVIDER`, `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `GOOGLE_VISION_API_KEY`. Details: `docs/SECRETS_CHECKLIST.md`.

## Android device-test checklist

- [ ] Fresh install: sign up, onboarding, logout, login, kill and reopen (session restored), switch accounts (no data from the previous account).
- [ ] Android 13+: notification permission prompt appears once, after the consent notice; denying it leaves the app usable.
- [ ] Match, like and message pushes: tap from foreground, background and cold start open the right screen; duplicate taps do nothing; lock screen shows generic text only.
- [ ] Free account cannot see incoming-like counts or identities; Premium/Plus/VIP can; expiring a subscription server-side removes access.
- [ ] Play Billing (internal testing track): purchase, renewal, cancellation, refund/revoke; entitlement follows the server only.
- [ ] Calls (only once a media adapter exists): ring while open, background, killed, locked; Answer, Decline, caller cancel, 60 s timeout, simultaneous Answer/Decline; second call while busy; airplane mode during ringing.
- [ ] Force-stop the app in Settings: confirm no push arrives until the app is opened (expected Android behaviour).
- [ ] Do Not Disturb / muted "Incoming calls" channel behaviour.
