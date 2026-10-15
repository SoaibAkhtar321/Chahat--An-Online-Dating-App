# Account deletion: current design and status

Status: **Server Edge Function (`delete-account`) now marks deletion pending, recursively removes nested media, and performs the database purge before deleting Auth (NOT DEPLOYED yet).**

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

## Server contract (`supabase/functions/delete-account/index.ts`, `verify_jwt = true`)

1. Identify caller from Authorization header (`auth.getUser()`); body is never trusted for the id.
2. Call service-role-only `begin_account_deletion(_uid)` to suspend the profile and record a pending
   deletion state before removing media.
3. Recursively delete `photos/<uid>/*`, including nested folders, and verify cleanup completion.
4. Delete all `chat/<matchId>/*` folders for all matches the user belonged to, including other participants' chat files.
5. `purge_user_data(_uid)` (granted to `service_role` only; revoked from PUBLIC, anon, authenticated).
6. `auth.admin.deleteUser(uid)` last ("not found" is treated as success), so a failure earlier leaves a
   suspended, still-authenticated account that can retry.
7. Returns `{ success: true }`, or HTTP 500 with `{ success: false, retryable: true, error }`; partial
   completion is explicit so a retry can finish remaining work.

The old `delete_user_account()` RPC is dropped by `supabase/migrations/20260101000300_mobile_security_hardening.sql`.

## Retained data (by design in `purge_user_data`)

- Reports are kept as moderation records, with reporter/target IDs replaced by deterministic deleted-user
  references. Report notes remain and require a retention/privacy-policy decision.
- Provider transaction rows are retained with `subscription_orders.user_id` set to `NULL`; the Auth user
  can be deleted without losing store references, token hashes, or amounts. Active entitlement rows are removed.
- An anonymized `admin_audit` row (`account_self_deleted`) is written per call; retries can add duplicate
  events. Audit retention and report-note retention still require a privacy-policy/legal decision.

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

## Migration order

1. `supabase/migrations/20260101000000_core_schema.sql`
2. `supabase/migrations/20260101000100_storage.sql`
3. `supabase/migrations/20260101000200_admin_moderation.sql`
4. `supabase/migrations/20260101000300_mobile_security_hardening.sql`
5. `supabase/migrations/20260101000400_security_followups.sql`
6. `supabase/migrations/20260101000500_privacy_and_rate_limits.sql`
7. `supabase/migrations/20260101000600_trigger_function_hardening.sql`
8. `supabase/migrations/20260101000700_subscription_entitlements_and_like_security.sql`
9. `supabase/migrations/20260101000800_photo_visibility_stopgap.sql`
10. `supabase/migrations/20260101000900_photo_reviews.sql`
11. `supabase/migrations/20260101001000_photo_visibility_approved_only.sql`
12. `supabase/migrations/20260101001100_uniform_like_quota.sql`
13. `supabase/migrations/20260101001200_daily_like_limit_20.sql`
14. `supabase/migrations/20260101001300_critical_security_foundations.sql`
15. `supabase/migrations/20260101001400_harden_verification_metadata_guard.sql`
16. `supabase/migrations/20260101001500_subscription_orders_and_replay_protection.sql`
17. `supabase/migrations/20260101002200_lifecycle_entitlements_release.sql`
