# Chahat release audit, part 2 — remaining blockers (base `ca6a7fc`)

Follows `docs/RELEASE_AUDIT_2026-10-28.md`. Verified against the code and a local PostgreSQL 16 built from all
62 migrations. Nothing was deployed, committed or pushed. No dashboard (Agora, Supabase, EAS, Play Console,
GitHub Actions) was accessible from this environment; everything marked "dashboard" is unverified.

## 1. Read receipts (fixed)

**Rule (from the code):** the *sender* of a message may see when the other person read it only on an active
Plus or VIP plan (`get_match_messages`, plan copy "Read Receipts Control (Plus and VIP only)"). Premium and free
senders see "sent/delivered" only. Delivery ticks are not premium. A recipient's own read state (unread badges)
is not a receipt and works on every plan.

**Vulnerability (verified):** `messages.read_at` was selectable by both chat members directly (table-level
SELECT for `authenticated`), so a modified client — or Supabase Realtime row payloads — exposed every receipt.
The app itself read `read_at` from the table for unread badges and the chat-list tick (which also showed "read" to
free users).

**Fix (`20260101005900_read_receipt_privacy.sql`):**
* Table-level SELECT on `messages` is replaced by a column grant of every column **except** `read_at`.
  PostgREST then refuses `read_at` in select lists, `*`, filters and `RETURNING`; Supabase Realtime only emits
  columns the subscriber may SELECT (`realtime.apply_rls` checks `has_column_privilege`), so receipts never reach
  the client over Realtime either.
* New server functions apply the plan rule: `get_chat_list_state(uuid[])` (unread counts for me + last-message
  receipt, masked), `mark_chat_read(uuid)` (members only; marks only the other person's messages).
* App: no `select("*")` on `messages`, no `read_at` filter or update, no table fallback in the chat;
  chat-list status is "read" only when the server says so.
* Old app builds already installed lose unread badges and mark-as-read until updated (they read `read_at`
  directly); messaging itself keeps working.
* Future migrations that add a column to `messages` must add it to the column grant (noted in the migration).

Tests: `supabase/tests/73_read_receipt_privacy.sql` (24 checks: free, Premium, Plus, VIP, expired Plus, both
participants, direct column / `*` / WHERE / RETURNING access, Realtime privilege basis, cross-user, anon,
blocked pair, idempotent mark-read) and `__tests__/readReceiptPrivacy.test.ts` (12).

## 2. Call allowance: failed connections and Agora events

**Before:** the clock starts when both participants have been issued Agora tokens (token-based, 005800). A
connection that failed after both got tokens was charged.

**Agora capability (verified in Agora docs):** Agora's RTC webhook ("Notifications", self-serve in Agora Console →
Webhooks) sends join/leave events (communication mode 107/108; live 103–106) with `channelName`, `account` (our
user id), `clientSeq`, `ts`, signed with HMAC-SHA256 (`Agora-Signature-V2`) using a Signing Secret. Delivery is
at-least-once, unordered, retried 3 times, so events can be duplicated, late or lost.

**Implemented (`20260101006000_agora_channel_events.sql`, Edge Function `agora-ncs`):**
* The function verifies the HMAC over the raw body before reading anything (401 otherwise, 503 if the secret is
  unset), ignores other products/events (200), and returns 500 on a database error so Agora retries.
* Events are stored once per `noticeId`, only for a real call channel and one of that call's two participants.
* Per participant, events are ordered by `clientSeq` and paired join → leave. Evidence is complete only when the
  call has ended and every participant with events has closed pairs.
* With complete evidence a call is charged **min(token-based seconds, seconds both were in the channel)**.
  Events can only lower a charge to the real overlap; they never extend a call or add time. Incomplete evidence
  (missing leave, leave without join, call still active) keeps the token-based charge.
* **Off by default** (`app_settings.call_agora_reconcile_enabled = 0`). Enable after the webhook health check.
* Residual limit (documented, not client-exploitable): if Agora loses both the join and the leave event of one
  participant after all retries, that participant looks absent and the call is under-charged. Monitor
  `public.agora_events_unpaired` (SQL editor).
* Without the webhook the system enforces token-based allowance (a hard media stop via token expiry). It does
  **not** claim exact connected-time billing in that mode.

Tests: `74_agora_channel_events.sql` (15 checks: reconcile off, failed connection, real overlap, never above
token-based, missing leave, delayed completion, leave without join, duplicates/forged duplicates, out-of-order,
reconnects, active call, junk/stranger/channel/timestamp, access), `75_allowance_concurrency.sh` (12 parallel
call attempts, 10 duplicate accepts, 16 parallel token grants, 12 duplicate events, 10 parallel rewinds),
`__tests__/agoraNcs.test.ts` (12). Exact 30/300 s limits, IST reset and expiry: `72_call_allowance_hardening.sql`.

## 3. Entitlement matrix (server-enforced, re-verified)

| Feature | Free | Premium | Plus | VIP | Server check |
|---|---|---|---|---|---|
| Likes / day | 50 (IST) | unlimited | unlimited | unlimited | `record_swipe` |
| Who liked me, count, access | — | yes | yes | yes | `get_received_likes`, `get_incoming_likes_count`, `get_my_likes_access` |
| "You liked" history | — | yes | yes | yes | `get_my_sent_likes` (own only) |
| Rewind pass | — | yes | yes | yes | `undo_swipe_pass` (own pass; blocked/suspended/deleted refused) |
| Read receipts (as sender) | — | — | yes | yes | column grant + `get_match_messages` / `get_chat_list_state` |
| Free call time / day | 30 s | 300 s | 300 s | 300 s | `transition_video_call`, token TTL, `call_allowance_used_today` |
| Coins after free time | coins only | — | — | — | `extend_call_coverage` (no purchase path yet) |

The client's `hasEntitlement` matches this table for undo and read receipts; "advancedFilters",
"priorityVisibility" and "incognito" exist only as client flags with no server feature behind them (not
advertised in the plan copy).

## 4. Google Play products

| Product ID | Intended | Entitlement | Code | Play Console | Required test |
|---|---|---|---|---|---|
| `chahat_pkg_149_7d` | ₹149 / 7 days | premium | verified + mapped | create: weekly auto-renew **or** 1-week prepaid | buy, cancel, expire, restore |
| `chahat_pkg_299_15d` | ₹299 / 15 days | plus | verified + mapped | **cannot be created as 15 days** (see below) | after decision |
| `chahat_pkg_499_1m` | ₹499 / 1 month | vip | verified + mapped | monthly / 1-month prepaid | buy, renew, refund |
| `chahat_premium_1m` / `_3m` / `_6m` / `_12m` | ₹99 / 249 / 449 / 799 | premium | verified + mapped | monthly / 3-, 6-month / yearly | buy one, renew, upgrade to Plus/VIP |
| `chahat_plus_1m` | ₹199 / month | plus | verified + mapped | monthly | buy, downgrade |
| `chahat_vip_1m` | ₹399 / month | vip | verified + mapped | monthly | buy, refund (RTDN revoke) |

**15-day plan:** Play auto-renewing base plans allow weekly, every 4 weeks, monthly, 2/3/4/6/8 months, yearly;
prepaid plans allow 1 day, 3 days, 1 week, 4 weeks, 1 month, 2/3/4/6/8 months, 1 year. 15 days / 2 weeks is not
offered. **Product decision needed** (not changed in code): e.g. 1-week or 4-week Plus plan, or drop the pack.
The product ID and server mapping can stay; only its duration/price in the Console and the plan copy change.

Code verified: account binding (`obfuscatedExternalAccountId = sha256(user id)`), package name, product/expiry,
pending purchases not granted, acknowledgement only after the server persisted the purchase (client), restore
re-queries, idempotent per token (advisory lock + unique token hash), order-scoped revocation with replacement
(upgrade/downgrade keeps the newer order), RTDN authenticated by Pub/Sub OIDC and re-read from Google.
Recommendation (not implemented): server-side acknowledgement as a backstop if the app dies before
`finishTransaction` (otherwise Google refunds after 3 days and RTDN revokes — consistent, but a lost sale).

## 5. Coins

Coin purchasing is still not implemented and no coin packs/prices exist in the repository (by design, see
`docs/BILLING.md`); `EXPO_PUBLIC_FEATURE_COIN_TOPUP` must stay `false`. Ledger audited: append-only, idempotent
keys per call minute, wallet RLS read-own only, `apply_coin_transaction` not callable by clients, existing
concurrency tests cover parallel spends/replays. Free and Premium calling work without coins (free callers are
refused after 30 s). Business decision needed before building a purchase path: packs, prices, Play product IDs.

## 6. Remaining blockers (verified, external)

1. Agora Console: App Certificate **enabled** for the project whose App ID is in `mobile/eas.json`
   (`cca3…e08f`); confirm it is the production project. (Project Management → Config → Security.)
2. Supabase secrets set: `CALL_PROVIDER=agora`, `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, Play and Pub/Sub
   secrets (`docs/SECRETS_CHECKLIST.md`). Optional: `AGORA_NCS_SECRET` + webhook.
3. EAS "production" environment has `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the
   build now fails fast if missing, placeholder, a secret key, or if calls are on without a valid Agora App ID).
4. 15-day plan decision; create products; service account; RTDN; license testers; purchase tests.
5. Physical-device tests and GitHub Actions results: not run from here.

## 7. Deploy order (after CI is green; nothing here was applied)

1. `20260101005900_read_receipt_privacy` — ship together with the new app build (older builds lose unread
   badges/mark-read). Rollback: `GRANT SELECT ON public.messages TO authenticated;` restores the old access
   (and the leak); the new functions are harmless to keep.
2. `20260101006000_agora_channel_events` — inert until enabled. Rollback: set
   `call_agora_reconcile_enabled = 0`.
3. Edge Function (optional): `supabase secrets set AGORA_NCS_SECRET=…` then
   `supabase functions deploy agora-ncs --no-verify-jwt`. Agora Console → Webhooks → New → RTC, URL
   `https://<project>.functions.supabase.co/agora-ncs`, events 107/108 (and 103–106), run health check.
   Compare a few days of data, then `UPDATE app_settings SET value='1' WHERE key='call_agora_reconcile_enabled';`.

## 8. Build commands

From `mobile/`: `eas build -p android --profile production` (AAB for Play; `autoIncrement` with remote
versionCode) and `eas build -p android --profile preview` (APK, arm64-v8a; `preview-compat` adds armeabi-v7a).
Billing works only on builds installed from a Play testing track.

## 9. Device checklist (additions to part 1)

* Free sender, then Plus sender: only Plus sees "read" ticks (chat and chat list); unread badges work for both.
* Calls: decline / ring out / one side cannot connect → allowance unchanged (with the webhook enabled).
* Reconnect mid-call → countdown does not reset; time stops at 30 s / 300 s.
* Purchase each product with a license tester, cancel, let it expire, refund one (check entitlement drops).
* Account deletion removes chats, calls and events (call events cascade with calls).
