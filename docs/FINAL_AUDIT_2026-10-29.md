# Final pre-release audit (2026-10-29)

Base: GitHub `main` 53e2fca (Expo 54) + profile sharing + Premium promise fixes + verification switched off.

## How it was checked
* Every `supabase.rpc(...)`, table and storage bucket the app uses was compared with a database built from all
  migrations: **all 0 mismatches** (every function exists and accepts the arguments the app sends). All 4 Edge Functions
  the app calls exist (`delete-account`, `issue-call-token`, `moderate-photo`, `verify-purchase`).
* Free vs Premium/Plus/VIP benefits checked on the server per tier (`supabase/tests/80_premium_promises.sql`).
* Jest 116 suites / 1180 tests, database suite 1193 checks + concurrency suite, type check, lint, Android JS bundle
  (`expo export -p android`): all pass. No phone/emulator here: the device checklist below is still needed.

## Location ("We couldn't match your location to a supported city")
That exact message came from the **old** location code (a short list of supported cities + the phone's geocoder).
It was replaced (commit 0b49190, migration 20260101005700): the server now picks the nearest of **4,264 Indian
places** within 150 km of the phone. Checked against remote points (Leh, Kargil, Tawang, Port Blair, Kanyakumari,
Jaisalmer desert, rural Bihar, Gadchiroli forest): all resolve. Only tiny far islands (Minicoy, Car Nicobar) don't;
those members can search their place. Phones still on an old APK will keep showing the old message until updated.

## Fixed in this pass
| Area | Problem | Fix |
|---|---|---|
| Free video call | A free member with no time left could still ring the other person; the call failed only when answered | Allowance checked before ringing; free members get the Premium offer, nobody's phone rings |
| Premium video call | A Premium member whose 5 min were used was shown "Get Premium" | Shown "You've used today's 5 minutes… renews at midnight" |
| Call timer | Premium calls said "Free time left" | "Time left today" for paid members |
| Call errors | Raw server text ("Could not create call invitation: A participant already has an active call") | Plain messages (already on a call / too many attempts / only matches / no internet) |
| Call controls | Calls screen promised camera flip; it did not exist | Front/back camera button added |
| Calls screen | "The first minute of every call is always free" (false) and "Calls & Billing" | Real allowance (30 s free / 5 min paid, midnight IST); renamed "Video Calls" |
| Me tab | "Video calls & billing ledger" (no ledger exists) | "Video calls" |
| Prepaid plans | Members could not see when their plan ends (no auto-renew) | "Active until 12 Nov" on Me tab and Premium screen |

Earlier today (same ZIP): profile sharing; Premium copy fixes; selfie verification hidden.

## Login
Email/password (wrong password, unconfirmed email, rate limit, switching accounts), Google sign-in, reset password and
email verification flows were reviewed; no defects found. Shared-profile links opened while signed out now continue
after login.

## Still needed before the Play Store AAB (not code in this ZIP)
1. **Google Play Billing Library 7** (react-native-iap 12): needs the react-native-iap 14 upgrade or Play's extension
   to 1 Nov 2026. This is the main blocker for purchases.
2. Plus/VIP prices and a VIP benefit (decision).
3. Confirm all Edge Functions are deployed: `npx supabase functions list` should show issue-call-token, verify-purchase,
   google-play-notifications, dispatch-push, agora-ncs, delete-account, request-account-deletion,
   process-deletion-requests, cleanup-chat-media, moderate-photo.
4. Website: profile-share page + assetlinks.json (docs/PROFILE_SHARING.md).
5. Device test on 2 phones (one free, one Premium) — docs/DEVICE_TEST_PLAN.md, plus: share link via WhatsApp,
   "Use my current location", free call after 30 s used, Premium call timer, switch camera.
