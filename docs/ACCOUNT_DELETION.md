# Account deletion: current design and status

Status: **Server Edge Function (`delete-account`) hardened with pagination, complete match folder media cleanup, and strict guard exceptions. Ready for deployment (NOT DEPLOYED yet).**

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
2. Delete `photos/<uid>/*` using `removeFolder` with a verified completion guard (throws if objects remain).
3. Delete all `chat/<matchId>/*` folders for all matches the user belonged to, including other participants' chat files, plus paginated cleanup.
4. `purge_user_data(_uid)` (granted to `service_role` only; revoked from PUBLIC, anon, authenticated).
5. `auth.admin.deleteUser(uid)` last ("not found" is treated as success), so a failure earlier leaves a
   still-authenticated account that can retry.
6. Returns `{ success: true }`, or HTTP 500 with `{ success: false, retryable: true, error }`.

The old `delete_user_account()` RPC is dropped by `supabase/migrations/20260101000300_mobile_security_hardening.sql`.

## Retained data (by design in `purge_user_data`)
- Reports are kept as moderation records (no foreign key).
- One `admin_audit` row (`account_self_deleted`, containing the user id) is written per call, so a retried
  deletion adds another row. `admin_audit.admin_id` has no foreign key, so it does not block the Auth deletion.

## Recent security hardening (Resolved)
- Storage list pagination in `removeFolder` fixed (loops up to 50 iterations of 100 items).
- `removeFolder` throws if files remain after limit instead of failing silently.
- Deleting an account purges the entire `chat/<matchId>/*` folder, removing other participants' chat files for that match as well.
- Photo path ownership enforced in `profiles_guard` (cannot set paths outside `uid/`).
- `search_path = public, pg_temp` enforced on all `SECURITY DEFINER` functions.
- `is_demo` and `likes_you` removed from `get_discovery_feed` and revoked from `authenticated` on `profiles`.
- Rate limits added: max 30 messages/minute per sender, max 10 reports/hour per reporter.

## Open items & remaining concerns (Honest status)
- Photo approval is NOT enforced in schema/storage policies (in-app privacy copy was reworded instead).
- Signed URLs (1 hour) cannot be revoked on block, suspension, or deletion until they expire naturally.
- No EXIF / GPS stripping or server-side re-encoding of uploaded images.
- No upload rate limiting (only message and report rate limits implemented).
- Reports and one `admin_audit` row are retained after account deletion (DPDP compliance check needed).
- Supabase Auth settings (email confirmations, password rules, OTP limits) are not codified in `config.toml`.
- All database test runs so far ran on plain PostgreSQL 16 with test stand-ins, not against a real Supabase instance.

## Migration order
1. `supabase/migrations/20260101000000_core_schema.sql`
2. `supabase/migrations/20260101000100_storage.sql`
3. `supabase/migrations/20260101000200_admin_moderation.sql`
4. `supabase/migrations/20260101000300_mobile_security_hardening.sql`
5. `supabase/migrations/20260101000400_security_followups.sql`
6. `supabase/migrations/20260101000500_privacy_and_rate_limits.sql`
7. `supabase/migrations/20260101000600_trigger_function_hardening.sql`