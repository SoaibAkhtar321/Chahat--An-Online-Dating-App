# Account deletion: current design and status

Status: **Edge Function (`delete-account`) marks deletion pending, removes media, purges the database, then deletes Auth (NOT DEPLOYED yet). Step 5 changes (migration `20260101003500_account_deletion_hardening.sql`, function refactor, tests) are STAGED LOCALLY: not committed, not applied to any live database.**

## Flow

Settings > Delete account > two dialogs (continue, then type exactly `DELETE`) > `deleteUserAccount()`
in `mobile/src/services/auth.ts` > `supabase.functions.invoke("delete-account", { body: { confirm: true } })`.

- The helper `mobile/src/utils/deletionFlow.ts` guards against double submission and requires the exact
  word `DELETE` (case-sensitive, trimmed).
- Success is `data.success === true` only. The local session is then cleared with
  `signOut({ scope: "local" })` (no server call; the Auth user no longer exists). If that sign-out fails the
  result is still success, with a warning.
- Errors: 401 -> session expired (log in again); 404 -> function unavailable (not deployed); other
  non-2xx -> the function's own message and `retryable` flag when present; network failure -> retryable.
- There is no client-side fallback (no RPC, no direct table deletes).

## Server contract (`supabase/functions/delete-account/` : `index.ts` wiring, `deletion.ts` logic, `verify_jwt = true`)

1. Identify caller from Authorization header (`auth.getUser()`); body is never trusted for the id.
2. Call service-role-only `begin_account_deletion(_uid)` to suspend the profile and record a pending
   deletion state before removing media.
3. Recursively delete `photos/<uid>/*`, including nested folders, and verify cleanup completion.
4. Delete all `chat/<matchId>/*` folders for all matches the user belonged to, including other participants' chat files.
5. `purge_user_data(_uid)` (granted to `service_role` only; revoked from PUBLIC, anon, authenticated).
6. `auth.admin.deleteUser(uid)` last ("not found" is treated as success), so a failure earlier leaves a
   suspended, still-authenticated account that can retry.
7. Returns `{ success: true }`, or HTTP 500 with `{ success: false, retryable: true, code: "deletion_incomplete", failedStep, error }`; partial
   completion is explicit so a retry can finish remaining work. A missing/invalid JWT gets 401 (`unauthenticated` / `invalid_session`) and nothing is touched.
8. If the Auth user was already deleted but the success response was lost, the retry gets 401 (the JWT no longer
   resolves). The app tells the user to try logging in: login failing means the deletion finished.

The old `delete_user_account()` RPC is dropped by `supabase/migrations/20260101000300_mobile_security_hardening.sql`.

## What is deleted, what is kept (per category)

Retention PERIODS are not set anywhere in the repo. Every period below is **"needs legal decision"**; none has been invented.
Access for retained rows = service role / database admins only (clients cannot read them: reports and `admin_audit` are
admin-only, `subscription_orders` rows with `user_id = NULL` match no user's RLS policy).

| Category | Where | On deletion | Purpose if kept | Retention period |
|---|---|---|---|---|
| Profile, account state, quotas, subscriptions (entitlements) | `profiles`, `account_state`, `user_daily_quotas`, `user_subscriptions` | Deleted | n/a | n/a |
| Profile photos, verification selfies | storage `photos/<uid>/` (incl. `verification/`), `photo_reviews` | Deleted | n/a | n/a |
| Matches, likes, blocks, messages, chat images and voice | `matches`, `swipes`, `blocks`, `messages` (cascade), storage `chat/<matchId>/` | Deleted for current matches. Messages vanish for the other person too | n/a | n/a |
| Location | `discovery_locations`, `discovery_location_settings` | Deleted | n/a | n/a |
| Push tokens, notification preferences and queue | `push_devices`, `notification_*` | Deleted (tokens already removed when deletion starts) | n/a | n/a |
| Call records and rate limits | `video_calls`, `call_events`, `call_token_rate_limits` | Deleted (also removes the other party's history of those calls) | n/a | n/a |
| Terms/Privacy acceptance evidence | `legal_acceptances` | **Deleted** (FK cascade). Open decision: erasing evidence of acceptance may be a risk in a dispute | Would be: proof of acceptance | **Needs legal decision** |
| Optional-consent evidence | `consent_records` | **Deleted** (FK cascade). Same open decision | Would be: proof of consent/withdrawal | **Needs legal decision** |
| Coin wallet and ledger | `coin_wallets`, `coin_transactions` | **Deleted** (FK cascade; the append-only trigger permits only this cascade). Unspent coins are lost. Open decision: `subscription_orders` is retained but this payment-related ledger is not | Would be: payment/accounting records | **Needs legal decision** |
| Subscription payment records | `subscription_orders` | **Kept**, `user_id` set to NULL (store order id, token hash, amount, dates remain) | Payment/refund reconciliation | **Needs legal decision** |
| Reports about/by the user | `reports` | **Kept**, reporter/target replaced by `deleted:<md5>`; free-text notes remain (may contain personal data) | Moderation, safety | **Needs legal decision** (also whether notes must be scrubbed) |
| Deletion audit event | `admin_audit` | **Kept**, anonymised; exactly one `account_self_deleted` row per account (retries no longer add duplicates) | Proof that deletion happened | **Needs legal decision** |
| Third-party processing | Google Cloud Vision SafeSearch (photo moderation), Agora (calls), Google Play (billing) | Not controlled by this repo | n/a | Provider terms not reviewed here; list belongs in `serviceProviderConfirmation` |

Not deleted by this app: a Google Play subscription (the user must cancel it in Google Play; the delete dialog and the
Legal & Privacy screen both say so).

## Processing status and delay

Deletion runs synchronously in one request; there is no background queue. If it stops part-way the account stays
suspended and the app says it can be retried from Settings. There is no "pending deletion" screen and no
scheduled retry job. Requests that cannot be done in the app go through the privacy contact on the Legal & Privacy screen
(its address and response time are still placeholders in `operatorDetails.ts`).

## Known gap: orphaned chat media (unmatch / block)

Unmatching or blocking deletes the `matches` row (messages cascade) but not the files under `chat/<matchId>/`. Those
objects become unreachable and `delete-account` cannot find them via `matches`. `find_orphaned_chat_folders()`
(service role, read-only) measures it. No cleanup is implemented: it needs a product decision on whether unmatch/block
should delete media.

## Migration order

Apply every file in `supabase/migrations/` in lexical (timestamp) order. Do not hand-maintain a list here; the previous
list went stale. `20260101003500_account_deletion_hardening.sql` is the newest and is not applied anywhere yet.

## Recent security hardening (Resolved)

- Storage list pagination in `removeFolder` fixed (loops up to 50 iterations of 100 items).
- `removeFolder` throws if files remain after limit instead of failing silently.
- Storage folder cleanup traverses nested directories and fails rather than silently leaving nested objects.
- Deleting an account purges the entire `chat/<matchId>/*` folder, removing other participants' chat files for that match as well.
- Photo path ownership enforced in `profiles_guard` (cannot set paths outside `uid/`).
- `search_path = public, pg_temp` enforced on all `SECURITY DEFINER` functions.
- `is_demo` and `likes_you` removed from `get_discovery_feed` and revoked from `authenticated` on `profiles`.
- Rate limits added: max 30 messages/minute per sender, max 10 reports/hour per reporter.
- Approved-only photo visibility enforced in schema (`20260101001000_photo_visibility_approved_only.sql`).
- Block isolation enforced at DB level: `is_match_member`, `chat_folder_member`, `get_public_profile`, and `matches` SELECT policy all check `NOT is_blocked_pair`.
- Automatic database trigger `on_block_cleanup` cascades removal of matches and swipes upon block insertion.
- Explicit `photo_reviews` deletion added to `purge_user_data` before profiles deletion (`20260101001300_critical_security_foundations.sql`).
- Verification metadata tampering prevented via `account_state_guard` (`20260101001400_harden_verification_metadata_guard.sql`).
- Client EXIF/GPS stripping and upload rate limits active in `mobile/src/services/storage.ts`.
- Supabase Auth settings codified in `supabase/config.toml`.

## Open items & remaining concerns (Honest status)

- Signed URLs (1 hour) cannot be revoked on block, suspension, or deletion until they expire naturally on the storage CDN.
- Reports and anonymized audit events are retained after account deletion (including report notes; DPDP compliance check needed).
- All database test runs so far ran with stand-ins and unit test harnesses; execution against real Supabase / PostgreSQL 16 container required per deployment runbook.
- Legal decisions still open (see the retention table): evidence of Terms/consent acceptance and the coin ledger are erased with the account; reports (with free-text notes), payment orders and the anonymised audit event are kept with no defined period. These need qualified legal review before release.
- Orphaned chat media after unmatch/block is measured by `find_orphaned_chat_folders()` but not cleaned up.
- The Step 5 migration and the refactored function have been run only against a disposable local PostgreSQL 16 with Supabase stand-ins and jest fakes, never against a real Supabase project.
