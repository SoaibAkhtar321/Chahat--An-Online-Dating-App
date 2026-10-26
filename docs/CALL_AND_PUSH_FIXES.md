# Video call + push fixes (call UX, history, free-time clock, slow push)

## What changed in code
| Issue | Cause found in the repo | Fix |
|---|---|---|
| "Invitation sent. Waiting for the other person to accept." / "Cancel request" | Hard-coded strings in `mobile/app/call/[id].tsx` | Normal call UI: **Calling… / Ringing… / Connecting… / 0:12**, round red hang-up button, round Answer/Decline, "No answer" / "Missed call" / "Call declined" / "Call ended" |
| "You don't have enough coins" | `callMedia.ts` message + `call_expired` mapped to "no longer available" | New `allowance_ended` code. Message and **Get Premium** button (caller only, free plan only) |
| 15 s used up by several 5-7 s calls | The allowance clock started when the recipient tapped Answer. The caller only learned "accepted" on a 5 s poll, then joined, so the seconds spent connecting were burned | `mark_call_connected` RPC: the clock starts only when **both** phones are in the call. Accept adds a 30 s connection grace. Allowance counts connected time only (a client that never reports in still burns the allowance after the grace). Polling is now 1.5 s while ringing/connecting |
| Only one face / no face | Free callers got an Agora token whose lifetime equalled the seconds left in the window (often 1-9 s) and Agora removes the user when it expires. Also no signal for "other camera not ready" | The grace removes the tiny token lifetime. The adapter tracks `onRemoteVideoStateChanged`/`onFirstRemoteVideoDecoded`. The screen shows "Waiting for X's camera…" instead of a black box |
| Missed/received calls not in chat | Nothing wrote call outcomes to `messages` | Trigger on `video_calls` writes a `system` message (`call|video|missed|<id>|<secs>`). `ChatBubble` renders a centered line ("Missed video call", "Outgoing video call · 0:23"). The chat list preview shows it too. System messages never send a message push |
| Slow notification when app is closed | See next section: this is deployment and scheduler, not app code | Diagnostic SQL below |

Files: `supabase/migrations/20260101005500_call_connect_clock_and_history.sql`, `mobile/app/call/[id].tsx`,
`mobile/src/services/{agoraCallMedia.tsx,callController.ts,callMedia.ts,callToken.ts,calls.ts,chat.ts}`,
`mobile/src/components/chat/ChatBubble.tsx`, `mobile/src/utils/callEvents.ts`, tests.

## Deploy order
1. `supabase db push` (applies `...005500`). Redeploy nothing else on the server for the call fixes.
2. Build a new dev/production APK (JS + native module unchanged, so an EAS update also works).

## Slow push (1-2 minutes with the app fully closed)
The code path is already near real-time: inserting into `notification_outbox` fires `trg_push_dispatch_on_outbox`,
which calls `dispatch-push` through `pg_net`. **That trigger swallows every error**, so if the setup is incomplete
the app silently falls back to the pg_cron sweep (about 1 minute) which matches what you see. Check, in the SQL editor:

```sql
-- 1) Vault secrets the trigger needs. Both rows must exist.
select name from vault.decrypted_secrets where name in ('chahat_project_url','chahat_push_dispatch_secret');

-- 2) Is pg_net installed, and did the last calls succeed? (status_code must be 200)
select extname from pg_extension where extname in ('pg_net','pg_cron');
select id, status_code, left(content::text, 200) as body, created
from net._http_response order by created desc limit 10;

-- 3) Is the sweep scheduled?
select jobname, schedule, active from cron.job;
```
Common results:
- Step 1 returns fewer than 2 rows: create them (project URL like `https://<ref>.supabase.co`, no trailing slash, and the
  same value as the `PUSH_DISPATCH_SECRET` function secret).
  `select vault.create_secret('https://<ref>.supabase.co','chahat_project_url');`
  `select vault.create_secret('<PUSH_DISPATCH_SECRET>','chahat_push_dispatch_secret');`
- `status_code` 401/403: redeploy with `supabase functions deploy dispatch-push --no-verify-jwt` (the trigger sends no JWT).
- No rows in `net._http_response` after sending a message: `pg_net` is not enabled.
- Step 3 empty: schedule the sweep as a safety net, `select cron.schedule('dispatch-push-sweep','* * * * *', ...)` as in `docs/PUSH_SETUP.md`.

If the SQL checks are healthy and it is still slow, the delay is on the phone: Expo hands the message to FCM at once,
but Android (Xiaomi, Oppo, Vivo, Samsung "sleeping apps") delays or drops FCM for a force-stopped / battery-restricted app.
Test one device with battery optimisation set to "Unrestricted" and the app swiped away (not force-stopped). `ttl` is 60 s
and `priority` is `high` for calls already.

## Verified vs not verified
Verified here: `tsc --noEmit` clean; full Jest suite 102/102 suites, 1029 tests, including a new `callEvents` test and three
updated tests that asserted the old coin wording/old JSX.
NOT verified: the SQL migration (no Postgres available here: run `supabase db reset` and your pgTAP suite),
anything on a real device (Agora video, push timing, the new call screen layout).

## Ringtone for incoming calls
- `mobile/assets/sounds/chahat_ringtone.wav`: an original ~30 s chime ring (generated, no third-party audio). Replace the file
  (same name) if you want your own ringtone.
- App closed or in the background: the push uses a new Android channel `calls_ring` (ringtone audio attributes, max importance,
  the bundled sound, vibration). The server push policy sends `channelId: "calls_ring"`. A new channel id is required because
  Android never lets an app change the sound of an existing channel. Users still on the old build keep the old `calls` channel.
- App open: `IncomingCallOverlay` now plays the same ringtone in a loop with vibration until answered, declined or cancelled.
- Needs a NEW native build (the sound is bundled by the `expo-notifications` plugin in `mobile/app.json`); an OTA update is not
  enough. Redeploy `dispatch-push` (`supabase functions deploy dispatch-push --no-verify-jwt`).
- Limits (Expo cannot change these): when the app is closed the sound plays once for the length of the file (~30 s) rather than
  looping until you answer, and there is no full-screen call screen over the lock screen like WhatsApp. That needs native Android
  code (full-screen intent / ConnectionService, or a library such as Notifee) plus Google Play's full-screen-intent declaration.
  Silent mode and Do Not Disturb still apply to the channel.
