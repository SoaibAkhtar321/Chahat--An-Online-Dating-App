# Message deletion (Phase 3A: database / backend foundation)

STATUS: migration `20260101004200_message_deletion.sql` is staged, NOT applied to any hosted project. The mobile UI is Phase 3B.

## Behaviour
| | Delete for me | Delete for everyone |
|---|---|---|
| Who | any participant, on any message in the match | the **sender only**, active (not suspended) accounts |
| RPC | `delete_message_for_me(_message_id uuid)` | `delete_message_for_everyone(_message_id uuid)` |
| Stored as | row in `message_user_deletions` (no client access) | tombstone: `deleted_at` set, `body=''`, media paths/duration NULL, `message_type='text'` (irreversible) |
| Other participant | unaffected, media still readable | sees the tombstone row (no content), media denied |
| Media | untouched | paths queued in `chat_media_cleanup_queue` in the same transaction; Storage SELECT denied immediately; worker removes the object |
| Retry | idempotent (`already_deleted`) | idempotent (`already_deleted`, original `deleted_at`) |

Result codes (jsonb, `success:false` unless noted): `message_not_found` (unknown id and "not a participant" are deliberately indistinguishable), `forbidden` (participant, not the sender), `account_not_active`, `account_deletion_pending`. Unauthenticated callers raise `Authentication required`.

## Where content is hidden
- Direct queries and Realtime `postgres_changes`: policy `members read messages` excludes rows the caller deleted for themselves. A delete-for-everyone UPDATE event carries the scrubbed row only; `messages` keeps the default replica identity (never `FULL`, or `old` records would carry content).
- `get_match_messages(_match_id, _limit)`: excludes hidden rows before the newest-N limit; tombstones come back with `deleted_at` and no content. New column `deleted_at` (old signature dropped, no overload left behind).
- `open_view_once_message`: `message_deleted` / `message_not_found`, never consumes a hidden or deleted message.
- Push: `_notification_source_exists` treats a deleted message as gone (queued push suppressed); `get_push_display_context` never previews a deleted message or one the recipient deleted for themselves.
- Storage: `chat read members` denies every path in the cleanup queue, so no new signed URLs can be created.

## Cleanup worker (`cleanup-chat-media`)
Service-role RPCs: `claim_chat_media_cleanup(limit)` (SKIP LOCKED, stale locks reclaimed after 10 min), `complete_chat_media_cleanup(ids)`, `fail_chat_media_cleanup(id, error)` (retry forever, back-off 1,2,4..60 min). The queue stores only match id, message id and object path, so it survives account deletion without personal data. The Edge Function validates every path again before calling Storage.

## Manual Supabase steps (all need explicit approval; nothing was run against hosted Supabase)
1. Apply `20260101004200_message_deletion.sql` to **staging first** (SQL Editor or your normal migration flow). It is one transaction. Before relying on it, confirm no dashboard-created policy named `chat read members` differs from `20260101000100_storage.sql` (the migration replaces it).
2. `supabase secrets set MEDIA_CLEANUP_SECRET="<random 32+ bytes>"` and `supabase functions deploy cleanup-chat-media --no-verify-jwt`.
3. Schedule it like `dispatch-push` (see `docs/DEPLOYMENT_RUNBOOK.md`): store the same secret in Vault as `chahat_media_cleanup_secret`, then
```sql
select cron.schedule('cleanup-chahat-chat-media', '*/5 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'chahat_project_url') || '/functions/v1/cleanup-chat-media',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'chahat_media_cleanup_secret')),
    body := '{}'::jsonb);
$job$);
```
4. Monitor (service role / SQL editor): `select status, count(*), min(created_at), max(attempt_count) from chat_media_cleanup_queue group by 1;` Alert when a `pending` row is older than ~1 hour or `attempt_count` keeps growing (`last_error` holds a redacted reason).

## Unresolved risks / decisions
- **Signed URLs already issued stay valid until they expire** (Storage checks RLS only when a URL is created). The object is removed by the worker, so exposure ends at removal; before that, up to the URL TTL. Reduce chat signed-URL TTL if this matters (client change, Phase 3B).
- **Scrub is irreversible and there is no evidence retention.** Reports (`reports`) store no message content, so a deleted message cannot be reviewed by moderation afterwards. Suspended accounts are blocked from Delete for everyone to limit evidence destruction, but a retention window (hold scrubbed content for N days, readable by service role only) is a product/legal decision not made here.
- **No time limit** on Delete for everyone (no value was specified).
- **Backups / WAL** retain pre-deletion content until they age out; Storage object removal depends on the worker running.
- Unmatch/block removes the match and cascades messages, but not Storage objects (existing `find_orphaned_chat_folders()` gap, unchanged).
- Pre-existing, not changed here: `messages_guard` does not protect `is_view_once` / `viewed_at` / `viewed_by` / `expires_at` / `read_at`, and the recipient UPDATE policy lets a recipient write them directly.
- `message_user_deletions` is not in the Realtime publication (Realtime cannot RLS-filter DELETE events), so a second device learns about Delete for me on its next fetch.

## Notes for Phase 3B (client)
Unread counts and last-message previews read `messages` directly: add `.is('deleted_at', null)` to unread counts and render tombstones from `deleted_at`. The chat Realtime subscription only handles INSERT; add UPDATE handling for tombstones. The table fallback in `fetchMessagesForMatch` returns tombstones as plain rows with `body=''`, so the UI must key off `deleted_at` on that path too.
