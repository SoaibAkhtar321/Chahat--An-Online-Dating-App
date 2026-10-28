# Chahat pre-release audit — 2026-10-28 (base `0b49190`)

Scope: video-call allowance, Premium rewind / liked history, entitlements, RLS / grants, chat and calls,
Google Play Billing, Android release configuration. Everything below was checked against the code and a
local PostgreSQL 16 built from all 60 migrations. Nothing was deployed, committed or pushed.

## 1. Fixed in this patch

| # | Severity | Problem (verified) | Fix |
|---|---|---|---|
| 1 | High (free-time bypass) | The allowance clock started only when **both** phones called `mark_call_connected`; a call that never reported in was counted from accept + 30 s grace. A modified client could join the Agora channel, never report "connected", talk ~30 s per call and use **no** allowance, unlimited times (accepted calls are not rate limited). A late "connected" report also restarted the full window. | `get_call_join_context` (the only path to an Agora token) records each participant's join grant. When both hold a grant the allowance clock starts and `free_call_until` (which bounds every token TTL) is re-anchored to start + granted seconds. A late connect report can only move the clock earlier. Ringing / one-sided connecting still costs nothing. |
| 2 | Product rule | Free allowance was 15 s/day. | `call_free_daily_seconds = 30`. Premium/Plus/VIP stay 300 s. IST day. |
| 3 | Medium (broken feature) | The app calls `get_my_video_call_allowance`, which **did not exist**: every caller, including paid ones, was treated as "free / exhausted" on the call screen (wrong upgrade prompt). | New read-only RPC, own data only, `authenticated` only. |
| 4 | Low | Premium rewind (`undo_swipe_pass`) restored profiles that had since blocked the user, been suspended or deleted. | Returns `profile_unavailable`, deletes nothing. |
| 5 | Performance | No index for "who liked me" (`swipes.to_id`) or match lists by `matches.user_b`. | Two indexes. |
| 6 | Release blocker | The **production** EAS profile did not set `EXPO_PUBLIC_FEATURE_CALLS` / `EXPO_PUBLIC_AGORA_APP_ID`, so the Play build would ship with calling switched off (preview builds had it). | Added to `mobile/eas.json` production env (the App ID is public; the App Certificate stays server-side). |
| 7 | CI | `npm test` exited **1** with every test passing: `phase4Navigation` never unmounted its renderers, animations logged after teardown. | Renderers unmounted after each test; three consecutive full runs exit 0. |
| 8 | Test hygiene | `appConfigGoogleServices` failed on any machine with a real `mobile/google-services.json`; `legalWebsiteLinks` timed out on a cold Windows run. | Test made hermetic; per-test time budget raised to 30 s (assertions unchanged). |

## 2. Video-call allowance design (server-authoritative)

* **Who pays:** the caller (existing rule, unchanged). The recipient's allowance is never consumed.
* **Allowance:** `call_free_daily_seconds` (30) / `call_premium_daily_seconds` (300), chosen at accept from
  `get_active_subscription_tier` (expired / cancelled subscriptions are free). Never from the client.
* **Grant at accept:** `left = allowance − used_today`, computed under a per-caller advisory lock; one active
  call per participant is enforced by `create_video_call`, so two calls cannot spend the same seconds.
* **Clock start:** earliest of (a) both participants hold a join grant (+ `call_join_slack_seconds`, default 0)
  and (b) both reported connected. Before either, nothing is consumed.
* **Hard stop:** `free_call_until = start + left`; Agora tokens are issued with TTL ≤ remaining window, so
  media stops server-side even if the app's timer is wrong or the device clock is changed.
* **Usage:** `Σ min(granted, ended − start)` over calls accepted since 00:00 IST. Duplicate accepts / ends,
  token renewals and reconnects are idempotent and never move the start.
* **After exhaustion:** premium accept is refused (`daily_call_allowance_used`); a free caller can only
  continue with coins (purchasing coins is not implemented, see §5), otherwise refused with the same code.
* **Residual limits (documented, not code-fixable without Agora webhooks):** a call where both participants
  received tokens but the connection genuinely failed is charged from the second token to hang-up (the
  server cannot distinguish it from a call that connected silently). Agora's App Certificate **must** be
  enabled in the Agora console, otherwise tokens are not required and none of this binds. A call that
  straddles 00:00 IST is attributed to the day it was accepted.

Proof: `supabase/tests/72_call_allowance_hardening.sql` (35 checks incl. rewind: 30/300 grants, exact 30 s and 300 s caps,
bypass closed, late connect cannot extend, ringing costs nothing, repeated token requests, IST boundary,
expired subscription, exhausted refusal without charges, recipient untouched, service-only RPC).

## 3. Premium rewind and liked history

* **Rewind pass** (`undo_swipe_pass`): server checks Premium/Plus/VIP, own swipes only (no user id
  parameter), refuses blocked / suspended / deleted targets, duplicate undo is a no-op. Tested.
* **"You liked" history** (`get_my_sent_likes`, 20260101005400): paid-only on the server, own likes only,
  excludes blocked / inactive / demo profiles. Already correct; kept.
* **Undoing a like** is not a product feature (plans advertise "Undo Last Swipe (Rewind Pass)"), so it was
  not invented. If wanted, it needs a product decision about existing matches and notifications.

## 4. Entitlement matrix (server enforcement)

| Feature | Free | Premium | Plus | VIP | Enforced in | Bypass by modified client? |
|---|---|---|---|---|---|---|
| Daily likes | 50 / IST day | unlimited | unlimited | unlimited | `record_swipe` | No |
| See who liked you / count | no | yes | yes | yes | `get_received_likes`, `get_incoming_likes_count`, `get_my_likes_access` | No |
| "You liked" history | no | yes | yes | yes | `get_my_sent_likes` | No |
| Rewind pass | no | yes | yes | yes | `undo_swipe_pass` | No |
| Video call free time | 30 s/day | 300 s/day | 300 s/day | 300 s/day | `transition_video_call`, tokens | No (see §2 residuals) |
| Read receipts | no | no | yes | yes | `get_match_messages` hides `read_at` | **Yes — see §6.1** |
| Smart icebreakers / compatibility summary | client UI | | | | client only, computed from data the user can already see | Cosmetic only |
| Chat, attachments, deletion | match members | | | | RLS + `messages_guard` + storage policies | No (existing tests 47/55/60) |
| Calls with blocked / ineligible users | refused | | | | `create_video_call`, `transition_video_call`, `get_call_join_context` | No |

Grant/RLS sweep on the migrated schema: every `public` table has RLS on; every SECURITY DEFINER function
pins `search_path`; `anon` can execute only 5 harmless helpers and read only `legal_document_versions`;
no service-role key, Agora certificate or Play credential is referenced from `mobile/`.

## 5. Google Play Billing readiness

Code that exists and is correct:
* `react-native-iap` 12 with `requestSubscription` + offer token, `obfuscatedAccountIdAndroid = sha256(user id)`.
* `verify-purchase` Edge Function verifies with the Android Publisher API (subscriptionsv2), checks the account
  binding, pending state, product and expiry, records idempotently (`record_verified_google_purchase`), and the
  app acknowledges (`finishTransaction`) only after the server persisted it; restore re-queries purchases.
* `google-play-notifications` (RTDN) verifies the Pub/Sub OIDC token (audience + service account) and
  re-reads the subscription from Google before granting or revoking.
* Entitlement is read only from `user_subscriptions` via `get_active_subscription_tier` (expiry enforced).

Remaining **code** gaps:
* Coin top-ups are intentionally not implemented (`REGISTERED_COIN_PURCHASE_CLIENT = false`); free callers
  therefore cannot extend past 30 s except with admin-granted coins. Fine for launch if intended.

Remaining **Play Console / external** work (cannot be done from the repository):
1. Create subscriptions with exactly these product IDs, each with one base plan and (if used) offers:
   `chahat_pkg_149_7d`, `chahat_pkg_299_15d`, `chahat_pkg_499_1m`, `chahat_premium_1m`, `chahat_premium_3m`,
   `chahat_premium_6m`, `chahat_premium_12m`, `chahat_plus_1m`, `chahat_vip_1m`.
   Confirm the 15-day plan is configurable (auto-renewing base plans do not offer a 15-day period; it may
   need to be a prepaid plan, or the plan changed).
2. Link a Google Cloud service account to Play Console with "View financial data" + "Manage orders"; set
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `ANDROID_PACKAGE_NAME=com.chahat.dating` as Supabase secrets.
3. RTDN: create a Pub/Sub topic + push subscription to the `google-play-notifications` URL with OIDC auth;
   set `PUBSUB_PUSH_AUDIENCE` and `PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL`; deploy that function with JWT
   verification disabled (it verifies Google's token itself).
4. Upload a signed AAB to the internal testing track (Billing only works for builds installed from Play),
   add license testers, and test: purchase, pending (slow test card), cancel, restore on reinstall,
   expiry, refund/revoke (RTDN), upgrade between tiers.
5. A development build is required (no Expo Go): `react-native-iap`, `react-native-agora` are native.

## 6. Remaining release blockers / decisions (not fixed here)

1. **Read receipts are readable by every chat member.** `get_match_messages` hides `read_at` from free and
   Premium senders, but `messages.read_at` is also selectable directly (table SELECT + realtime), and the
   app itself reads that column to count unread messages. Fixing it safely needs a small refactor
   (unread-count RPC + column revoke + realtime check on a device). Impact: a modified client can see
   "read" without Plus. Decide whether to fix before launch or drop the claim from the Plus plan copy.
2. **Production Supabase variables** (`EXPO_PUBLIC_SUPABASE_URL`, publishable key) must exist in the EAS
   "production" environment; they are not in `eas.json` (correctly) and could not be verified from here.
3. **Agora App Certificate** must be enabled (token auth), and the Agora App ID in `eas.json` must be the
   production project's.
4. **Play Console** items in §5.
5. GitHub Actions results for this patch are **unverified** (no access from this environment).
6. Physical-device tests (below) have not been run.

## 7. Deployment order (do not run until CI is green)

1. Apply migrations: `20260101005700_dynamic_city_search` (if not yet applied), then
   `20260101005800_call_allowance_hardening_and_rewind`. Both are transactional and forward-only.
   Old app versions keep working: no RPC signature changed, `get_call_join_context` returns the same keys.
2. No Edge Function redeploy is required for this patch.
3. Build: `cd mobile && eas build -p android --profile production` (AAB, Play) or
   `eas build -p android --profile preview` (APK for direct install).

## 8. Physical-device checklist

* Free account calls a match: talk; the call ends at ~30 s; a second call is refused with the upgrade prompt.
* Premium account: 5 minutes total across calls; then refused with "renews tomorrow".
* Recipient never answers / declines / caller cancels while ringing: allowance unchanged
  (check the call screen or `get_my_video_call_allowance`).
* Airplane mode mid-call, rejoin: the countdown does not reset.
* Change the phone's date/time: no effect on the allowance.
* After 00:00 IST the allowance is full again.
* Premium rewind: pass a profile, tap Undo, the card returns; free account sees the upgrade dialog.
* Purchase / restore / cancel subscription from an internal-testing install (license tester).
