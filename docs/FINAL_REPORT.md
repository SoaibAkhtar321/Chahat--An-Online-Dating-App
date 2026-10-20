# Chahat final release report (6.7)

Base: `03b06c9` ("Incoming-call reliability"), which already contains Phases 1-5, Step A, the discovery performance
migration (`...004400`), the lockfile fix, 6.4 back navigation and 6.5 incoming-call audit.
This step adds the two docs, two small client fixes and one test file. No migration changes.

## Verification levels
| Level | Status |
|---|---|
| Code exists | Yes |
| Jest / typecheck / npm ci | Last run on this tree: 83 suites, 865 tests pass, typecheck 0 errors, `npm ci` OK. ESLint printed no errors but ignores `mobile/app` |
| SQL suite | Last full run covered migrations through `...004400`. Migration `...004500` and test 64 were **not** run in the 6.4 session |
| GitHub CI on this commit | Not confirmed by me; check the Actions tab |
| Hosted `milo-dev` | Migrations `...004300`, `...004400`, `...004500` not applied by me |
| Android build / EAS | Not run |
| Real device | Nothing tested (see `docs/DEVICE_TEST_PLAN.md`) |

## Fixes (this release line)
Missing `useCallback` import; locationPicker test mocks; four SQL fixture fixes (test 62); discovery feed block anti-join
(`...004400`, test 63); setting_int missing-key default (`...004500`, test 64); lockfiles synced; verification and
email-verify back handling with 4 tests; stale calls doc corrected; feature flags now enable only on the exact value `true` (was case-insensitive); discovery steps the radius down (250/100/50/25 km) if the server ceiling was lowered, instead of showing an empty deck (3 new tests).

## Migrations to apply to staging then production (in order, with your approval)
`...004300`, `...004400`, `...004500` (plus any earlier ones not yet applied; check `supabase migration list`).

## Dashboard and provider actions (yours)
- Auth: "Confirm email" setting, Site URL, redirect URLs (`docs/AUTH_SETTINGS_CHECKLIST.md`).
- Edge Function secrets: `CALL_PROVIDER=agora`, `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, plus the list in `docs/SECRETS_CHECKLIST.md`; redeploy `issue-call-token` and `dispatch-push`.
- Firebase `google-services.json` and FCM V1 key in EAS (`docs/PUSH_SETUP.md`).
- Run the legacy-city count query from the Step A review and decide on a backfill or "choose your city" prompt.

## Known issues and limits
- Killed-state Answer/Decline, full-screen intents and force-stop behaviour for calls are not guaranteed.
- No chat full-screen image viewer exists.
- Photo crop is a fixed centre crop; chat image and selfie use the system editor.
- Legacy members with unsupported free-text cities show no distance.
- Client slider max (500 km) is hardcoded; if the server ceiling is lowered the client now falls back to a smaller radius, but the slider still offers values above the ceiling.
- SQL function default `_radius_km` is 50, client default is 150 (client always passes it).
- Open 6.3 optional fix: `cursor_distance_m` for members who disabled distance sharing.
- ESLint config ignores `mobile/app`, so lint does not cover screens. Jest printed "did not exit one second after the test run" (not investigated).
- Notifications-off alert in settings does not mention calls.
- Expo dependency versions may mismatch SDK 52 (`npx expo install --check`); `eas.json` preview profile hard-codes Supabase URL/key; confirm need for external-storage permissions.

## Local commands
```powershell
npm ci --no-audit --no-fund; cd mobile; npm ci --no-audit --no-fund; cd ..
npm run lint; npm run build; npm test -- --ci
bash supabase/tests/run.sh   # disposable Postgres 16 on port 5433 only
cd mobile; npx expo prebuild --platform android --no-install
cd mobile; eas build --platform android --profile preview
```

## Security
Reviewed in earlier phases and 6.3 (RLS on all public tables, definer functions pin search_path, anon grants, Edge Function
auth, no service-role or Agora secrets in the app, `SYSTEM_ALERT_WINDOW` blocked). No new security-relevant code in this step.
Not verified against hosted projects or devices.

## Production readiness
**Not ready.** Blockers: apply migrations to staging and re-run SQL tests there; confirm CI green; FCM setup; signed Android
build; complete the device plan with no FAIL; resolve Expo version alignment.

## Must stay disabled in production until device-verified
`EXPO_PUBLIC_FEATURE_CALLS` and `EXPO_PUBLIC_FEATURE_VOICE_MESSAGES` default OFF; only the exact value `"true"` enables them.
Same rule for billing, push and coin top-up flags.
