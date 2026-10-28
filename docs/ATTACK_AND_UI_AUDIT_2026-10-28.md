# Attacker, tester and customer pass — 2026-10-28 (base `8baf6d6`)

Method: a signed-in FREE member attacked the migrated database directly (what a modified app or a script with the
public key can do: any table, any RPC, any parameter). The app's JavaScript bundle was built for Android
(`expo export -p android`). Screens and purchase/chat/call flows were reviewed in code. No device or emulator is
available here, so nothing was tapped on a real screen.

## 1. Regression I introduced in the last patch (fixed here)

`8baf6d6` removed `query-string` as "unused". `expo-router` 4.0 imports it without declaring it, so the app
**could not be bundled** (Metro: "Unable to resolve module query-string … expo-router/build/fork/getPathFromState.js").
Restored in both package.json files; `npx expo export -p android` now bundles 3,055 modules successfully. A test
(`__tests__/bundleDependencies.test.ts`) keeps it from happening again.

## 2. Attacker results (free member)

Blocked already (now also regression-tested in `supabase/tests/77_attack_surface.sql`): granting yourself
VIP, editing subscriptions, creating coins, resetting the like quota, inserting likes or matches, "who liked me"
and "you liked" as free, rewind as free, lengthening a call or inserting call rows, calling the token service,
making yourself admin, self-verification, changing your status/demo flags, reading read receipts, exact
locations, push tokens, other people's subscriptions, sending as someone else, messaging a non-match, editing
someone else's message, filing a report as someone else or pre-resolved.

**Fixed (`20260101006200_attack_surface_hardening.sql`):**

| # | Attack that worked | Impact | Fix |
|---|---|---|---|
| 1 | `select * from profiles` returned **every** active member (name, city, gender, seeking, intents, `last_active`, `created_at`, `user_id`, incl. not-onboarded accounts) | Scrape the whole user base in one request; track when anyone is online | Table reads limited to your own row (the app never reads other rows directly; others come through the feed/profile functions) |
| 2 | `get_active_subscription_tier('<anyone>')` | Learn anyone's paid plan | Revoked from clients (server code still uses it) |
| 3 | Insert a chat message with `message_type = 'system'` | Forge "missed call"/"call ended 1:00:00" or fake system notices in someone's chat | Clients cannot create system messages |
| 4 | Insert a message with `created_at` 10 years ahead, or pre-set `delivered_at/read_at/viewed_at` | Pin a message to the bottom of a chat forever; fake ticks | Server sets these on insert |
| 5 | `TRUNCATE` on public tables (platform default grant; bypasses RLS) | Not reachable via the REST API, but no reason to hold it | Revoked |
| 6 | Report a non-existent account or yourself | Moderation noise | Target must be another real member |
| 7 | Write a 5 MB blob into your settings (`account_state`) | Storage abuse | 16 KB cap |

Checked and fine: `is_blocked_pair` and `has_role` already refuse to answer about other people; location
spoofing cannot be prevented (coordinates come from the phone) but distances stay bucketed and city-to-city for
manual cities; priority likes are limited to 3/day for everyone (not a paid feature in the plan copy).

Left as low risk: the legacy `get_discovery_feed(_limit)` is still callable (returns nothing beyond the current
feed; older test suites use it).

## 3. Customer / tester findings (not changed — need your decision)

1. **The plan screen sells different products than it advertises.** Cards are titled "₹149 Plan (7 Days)",
   "₹299 Plan (15 Days)", "₹499 Plan (1 Month)" with "7/15 days validity", but the price shown and the product
   bought are the monthly subscriptions (`chahat_premium_1m` ₹99 and the 3/6/12-month options,
   `chahat_plus_1m` ₹199, `chahat_vip_1m` ₹399). The 7-day/15-day/₹499 "package" products can never be
   bought from the app. A customer who taps "₹149 Plan (7 Days)" is charged for a monthly ₹99 subscription.
   Decide which catalogue is real; then either rename the cards to the monthly plans, or switch the purchase to
   the package products (15 days is still not possible in Play).
2. Plan copy advertises icebreakers / compatibility (free for all) and a VIP badge (not built) — from the
   launch-readiness report.
3. Selfie verification needs a reviewer process (admin site) — from the launch-readiness report.

## 4. UI

* The web export fails (React Native internals not available on web); web is not a target, so a browser UI pass
  was not possible. No emulator here: a screen-by-screen visual test was **not** done.
* Code review: no dead buttons (`onPress={() => {}}`), no leftover "Milo"/old-allowance strings in screens; the
  Premium button shows "Coming soon" only when billing is disabled (it is enabled in production).
* Do the device checklist (`docs/DEVICE_TEST_PLAN.md` + the audit checklists) on a real phone.

## 5. Verification

* `npm run lint` 0 errors; `npm run build` 0 errors; `npm test -- --ci` 111 suites, 1133/1133, exit 0.
* `bash supabase/tests/run.sh`: 1148 functional checks + 57 concurrency checks, 0 failures (64 migrations).
* `npx expo export -p android`: bundle OK (3,055 modules).
* `npm audit --omit=dev` (mobile): 24 (two `query-string`-related moderates return with the required package;
  all others need the Expo SDK upgrade).
