# Account deletion: current design and open items

Status: **client work only. The server function is committed but NOT deployed.** Verified from the
repository at `b3fc87c`; the remote Supabase project has not been inspected.

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
1. Identify the caller from the Authorization header (`auth.getUser()`); the body is never trusted for the id.
2. Delete `photos/<uid>/*` and the chat images the user sent (`messages.sender = uid`).
3. `purge_user_data(_uid)` (granted to `service_role` only; revoked from PUBLIC, anon, authenticated).
4. `auth.admin.deleteUser(uid)` last ("not found" is treated as success), so a failure earlier leaves a
   still-authenticated account that can retry.
5. Returns `{ success: true }`, or HTTP 500 with `{ success: false, retryable: true, error }`.

The old `delete_user_account()` RPC is dropped by `supabase/migrations/20260101000300_mobile_security_hardening.sql`
(the copy under `drizzle/migrations/` is historical and still defines it).

## Retained data (by design in `purge_user_data`)
- Reports are kept as moderation records (no foreign key).
- One `admin_audit` row (`account_self_deleted`, containing the user id) is written per call, so a retried
  deletion adds another row. `admin_audit.admin_id` has no foreign key, so it does not block the Auth deletion.
  The privacy policy should describe this retention.

## Open items (none are fixed by the client patch)
1. **Not deployed.** Until it is, deletion fails with the "unavailable" message. Deploy to a development
   project first and test with a disposable account, including an interrupted run followed by a retry.
2. **Chat-media query is not paginated.** The `messages` select returns at most the project's row limit
   (1000 by default). `purge_user_data` then cascades the messages away, so files beyond the limit could no
   longer be found on a retry.
3. **Other participants' files.** Only images the deleting user sent are removed; files in `chat/<matchId>/`
   sent by the other person stay in Storage after the match rows are purged. Decide: delete the match folder
   or document the retention.
4. **`removeFolder` can exit quietly.** After its 50-pass guard it returns without error even if objects
   remain. Current photo paths are flat (`<uid>/<photoId>.jpg`), so this is fine today, but it should throw.
5. **Remote state unverified.** Confirm the old RPC is gone and the grants match the migration on the
   real project (`select proname, proacl from pg_proc where proname in ('delete_user_account','purge_user_data');`).
6. **Minor.** The function imports supabase-js 2.45.4 while the app uses ^2.49.1; the error log includes the user id.