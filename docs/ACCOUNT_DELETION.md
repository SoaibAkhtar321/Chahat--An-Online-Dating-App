# Account deletion: current design and status

Status: **Server function hardened with pagination, complete match folder media cleanup, and strict guard exceptions. Ready for deployment.**

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
3. Delete all `chat/<matchId>/*` folders for all matches the user belonged to, plus paginated cleanup of leftover media.
4. `purge_user_data(_uid)` (granted to `service_role` only; revoked from PUBLIC, anon, authenticated).
5. `auth.admin.deleteUser(uid)` last ("not found" is treated as success), so a failure earlier leaves a
   still-authenticated account that can retry.
6. Returns `{ success: true }`, or HTTP 500 with `{ success: false, retryable: true, error }`.

The old `delete_user_account()` RPC is dropped by `supabase/migrations/20260101000300_mobile_security_hardening.sql`.

## Retained data (by design in `purge_user_data`)
- Reports are kept as moderation records (no foreign key).
- One `admin_audit` row (`account_self_deleted`, containing the user id) is written per call, so a retried
  deletion adds another row. `admin_audit.admin_id` has no foreign key, so it does not block the Auth deletion.