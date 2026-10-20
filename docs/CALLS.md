# Calls: provider architecture (Phase 3)

Status: server side is implemented and tested locally (Agora token provider, authoritative expiry,
recipient signaling, recovery snapshot, ringing push). **The mobile media adapter is not written and
nothing has been deployed or verified against Supabase or Agora**, so the UI gate stays closed and
calling is reported as unavailable. Not production-ready until the steps under "Deployment" are done.

## How a call works

1. `create_video_call` (RPC) creates a pending invitation for a match. The recipient accepts through
   `transition_video_call`. Both are server-owned and unchanged by this phase.
2. Once the call is `accepted`, a participant's app asks the `issue-call-token` Edge Function for a
   join token. The body contains only `call_id`.
3. The function validates the JWT with Supabase Auth, throttles the user, asks the database for the
   call's facts, decides, and only then talks to the call provider.
4. The app passes the returned grant to the media adapter, which joins the room.
5. Ending the call is a server transition (`transition_video_call(..., 'end')`). The app leaves the
   media session first, then ends the call on the server.

## Server

| Piece | File | Role |
|---|---|---|
| Provider interface | `supabase/functions/_shared/callProvider.ts` | `ensureRoom`, `issueJoinToken`, `endRoom`, plus the `NotConfiguredCallProvider` and `resolveCallProvider` |
| Policy | `supabase/functions/issue-call-token/policy.ts` | Pure rules: request shape, join decision, token lifetime |
| Handler | `supabase/functions/issue-call-token/handler.ts` | Whole authorization flow with injected dependencies (unit tested) |
| Entry point | `supabase/functions/issue-call-token/index.ts` | Wires Supabase clients and the provider into the handler |
| Migration | `supabase/migrations/20260101002300_call_token_rate_limit.sql` | Rate-limit table and function, and `get_call_join_context` |

Authorization, in order. Any failure stops the request before the provider is contacted:

| Step | Failure | Response |
|---|---|---|
| Valid bearer JWT, verified by Supabase Auth | missing or invalid | 401 `unauthenticated` |
| Body is exactly `{ "call_id": <uuid> }` (forged `participant_id`, `user_id` and other keys are rejected) | malformed | 400 `invalid_request` |
| Per-user rate limit (default 10 per minute, `app_settings.call_token_rate_limit_per_minute`) | exceeded | 429 `rate_limited` with `Retry-After` |
| Caller is the call's caller or recipient (strangers and unknown ids look identical) | not a participant | 404 `call_not_found` |
| Match not blocked, both profiles active and onboarded | ineligible | 403 `call_not_allowed` |
| Call status is `accepted` | pending | 409 `call_not_accepted` |
| Call is not declined, cancelled, timed out or ended | closed | 410 `call_ended` |
| Free allowance has time left (when one applies) | used up | 410 `call_expired` |
| Provider configured | not configured | 503 `provider_not_configured` |
| Caller can pay for the next minute (Phase 4, only when metered and near the end of covered time) | no coins | 402 `insufficient_coins` |
| Provider calls succeed | provider failure | 502 `provider_error` (generic text, details only in server logs) |

On success the response contains only `provider`, `room_id`, `token`, `expires_at`, `call_type`.
Token lifetime is at most 120 seconds and never longer than the call's remaining free allowance.
The participant identity given to the provider is the verified user id, never a request value.

The two new database functions are `service_role` only. Clients cannot call them or read the
rate-limit table. Idempotency: the migration is safe to re-apply (checked locally).

## Client

| Piece | File |
|---|---|
| Media provider interface, error codes, UI gate | `mobile/src/services/callMedia.ts` |
| Token request and error mapping | `mobile/src/services/callToken.ts` |
| Join, mute, camera and hang-up state machine | `mobile/src/services/callController.ts` |
| React hook | `mobile/src/hooks/useCallController.ts` |
| Route helpers (match id plus type) | `mobile/src/services/calls.ts` |

`isCallingAvailable()` is true only when `EXPO_PUBLIC_FEATURE_CALLS=true` **and** a media adapter is
registered. With the shipped build both are false, so:

- chat call buttons are hidden;
- the Calls screen shows "Video calling is not available yet" instead of call buttons;
- the call screen refuses to create an invitation and shows no mute or camera controls.

The chat buttons previously opened the call screen with the other user's id and no call type, which
could not work. They now pass the match id and an explicit type.

## Behavior before a provider is configured

The Edge Function answers `provider_not_configured` (503) to every authorised request. The app never
reaches that point because the UI gate is closed. Nothing is simulated.

## Lifecycle, expiry and signaling (migration `20260101002700_call_lifecycle_expiry_signaling.sql`)

States: `pending` -> `accepted` | `declined` | `cancelled` | `timed_out`; `accepted` -> `ended`.
All transitions happen in the database under a row lock (`transition_video_call`, `expire_video_calls`).

### Expiry (authoritative, server-side)
- `expire_video_calls(limit, users)` is idempotent and race-safe (`FOR UPDATE SKIP LOCKED` plus a
  status re-check). It times out pending calls past `expires_at` (60 s, set at creation) and ends
  accepted calls when the authorised time lapses (`free_call_until`), or, for unmetered calls, after
  `call_max_duration_seconds` (default 10800, settable in `app_settings`, 600 to 86400). Ending an accepted call
  fires the existing billing settlement trigger. It also deletes `call_events` older than 24 h.
- Why it was needed (verified): expiry used to be lazy, so abandoned pending rows blocked the one-pending-per-match
  index and abandoned accepted calls (notably unmetered ones) stayed `accepted` forever, blocked both users and
  were never settled.
- Scheduling: the migration schedules `expire-video-calls` every minute with `pg_cron` if the extension is available,
  and only warns otherwise. Verify with `SELECT jobname, schedule, active FROM cron.job;` and inspect
  `cron.job_run_details` for failures. A failed run is harmless: the next run retries, and lazy sweeps also run
  in `create_video_call`, `get_call_sync`, `get_my_video_calls` and `transition_video_call`. Worst-case lag for a
  ringing call to be marked `timed_out` is about 60 s after `expires_at`; accept is refused from `expires_at` onwards.

### Signaling
- `call_events` (RLS: `user_id = auth.uid()`, SELECT only, in the `supabase_realtime` publication). A trigger on
  `video_calls` writes `incoming` to the recipient only, and the new status to both participants, for every
  status change from any code path. Rows hold ids, type and `expires_at`; never provider tokens or billing data.
- Client subscribes to INSERTs on `call_events` filtered by `user_id=eq.<own id>`.
- Recovery: `get_call_sync()` returns `{server_time, last_event_id, incoming[], active[]}` after sweeping the
  caller's own stale calls. Call it on app start, foreground and Realtime reconnect; apply events with
  `id > last_event_id` on top; ignore an event whose call is already newer in the snapshot. Events and push are hints,
  the database row is the truth.
- Ringing push: category `call` through the existing outbox / `dispatch-push` pipeline (no new provider). TTL 60 s,
  generic copy, data holds only `callId` and `matchId`. Deliveries are suppressed if the call is no longer pending,
  the caller is blocked, or the recipient disabled `notification_preferences.calls`.

### Abuse limits
At most 3 unanswered invitations per caller per match and 6 per caller overall in 10 minutes
(`call_create_limit_per_match_10min`, `call_create_limit_per_10min`). Accepted calls do not count.

## Android incoming calls (Phase 3)

Migration `20260101003900_phase3_incoming_call_actions.sql` (apply after `...003800`; **not applied to any hosted project**).
It changes one function, `transition_video_call`: a repeated action by the same participant on a call already in the
requested state (`decline`/`accept` by the recipient, `cancel` by the caller, `end` by either) now returns
`{success: true, status, replayed: true}` instead of raising. No row update, no second `call_events` row, no second
charge. Everything else about the function (row lock, recipient-only checks, expiry, allowance, billing) is unchanged.

### What happens when a call arrives

| App state | What the recipient gets | Where it is handled |
|---|---|---|
| Open | In-app incoming-call screen with Answer/Decline and a vibrating ring. A system notification is deliberately **not** shown (`shouldPresentInForeground`). | `IncomingCallContext` + `IncomingCallOverlay` |
| Background, process alive | Heads-up notification on the `calls` channel with **Answer** (opens the app) and **Decline** buttons. | Android + `NotificationResponseHandler` |
| Process killed (not force-stopped) | Same notification, delivered by FCM through Expo push. **Answer** launches the app, which reads the launch response and answers. | `getLastNotificationResponseAsync` |
| Locked | Same notification with the lock-screen content hidden (`lockscreenVisibility: PRIVATE`). | channel config |

Answer, Decline and a tap on the body all go through `incomingCallController`, which calls `transition_video_call`
(server-validated recipient, atomic) and then `get_call_sync` to learn what really happened. The push payload is only a hint:
it carries `callId`, `matchId` and `callType` (never a caller name, token, room or credential) and nothing in it decides
whether a call may be answered. Tokens for joining come from `issue-call-token` as before.

Signaling: `call_events` Realtime subscription filtered to the signed-in user, with `get_call_sync()` on start, on every
Realtime (re)subscription, on app foreground and when a call push is received in the foreground. Events with
`id <= last_event_id` and events for already-closed calls are ignored, so duplicate pushes/events never ring twice.
The ring stops and the notification is dismissed on cancel, decline, answer elsewhere, expiry (server clock) and sign-out.

### Files

| Piece | File |
|---|---|
| Channel/category names, payload parsing, action mapping (pure) | `mobile/src/services/callNotificationPolicy.ts` |
| Snapshot/event reducer, expiry, "which call rings" (pure) | `mobile/src/services/incomingCallState.ts` |
| Answer/Decline/sync/sign-out state machine (injected side effects) | `mobile/src/services/incomingCallController.ts` |
| Channel + Answer/Decline category, dismiss, in-app vibration | `mobile/src/services/callNotifications.ts` |
| `get_call_sync` + Realtime wiring | `mobile/src/services/callSignaling.ts` |
| Provider, hook, overlay | `mobile/src/context/IncomingCallContext.tsx`, `mobile/src/components/calls/IncomingCallOverlay.tsx` |
| Recipient Answer/Decline on the call screen | `mobile/app/call/[id].tsx` |
| Server payload (channel `calls`, category `incoming_call`, ttl 60 s) | `supabase/functions/dispatch-push/policy.ts` |

### Android build, permissions and EAS

- No native module, config plugin or prebuild change was added: this uses `expo-notifications` already in the build.
  A new development/preview build is needed only because the JavaScript changed (OTA is not configured here).
- Manifest: `android.permission.VIBRATE` was added to `app.json` (normal permission, no prompt; used for the in-app ring).
  `POST_NOTIFICATIONS` (Android 13+ runtime permission) is already merged by `expo-notifications`; the existing
  push registration asks for it once, after the in-app consent notice. **Not** requested: `USE_FULL_SCREEN_INTENT`,
  `SYSTEM_ALERT_WINDOW`, foreground-service or telecom permissions.
- Push prerequisites are unchanged (`docs/PUSH_SETUP.md`): Firebase `google-services.json`, FCM V1 key in EAS, deployed
  `dispatch-push` (**redeploy it**: `policy.ts` changed), `EXPO_PUBLIC_FEATURE_PUSH=true`. Calls additionally need
  `EXPO_PUBLIC_FEATURE_CALLS=true` and a registered media adapter (still missing, see below).
- The `calls` channel is created at sign-in. Android freezes a channel's sound/importance once created, so changing
  those later needs a new channel id. A user who muted "Incoming calls" in system settings will not hear it.

### Android limits (read before promising anything)

- **Force-stop:** if the user force-stops Chahat in Android Settings, Android blocks all background work and FCM delivery
  until the app is opened manually. Nothing here can ring in that state, and it is not guaranteed anywhere else either:
  doze, battery optimisation, OEM task killers and Do Not Disturb can delay or silence a push.
- **No full-screen call UI, no looping ringtone when the app is closed.** Expo's notification API cannot set a
  full-screen intent or loop a ringtone. The channel plays Android's default notification sound once and vibrates; the
  in-app screen only appears when the user opens the app (Answer button or tapping the notification). A true
  lock-screen call experience needs native Android code (a `FirebaseMessagingService` posting a `fullScreenIntent` or
  a ConnectionService/foreground-service flow), a config plugin and a Google Play "full-screen intent" declaration.
  That was deliberately not attempted without an Android SDK/device to build and verify it.
- **Decline from a dead process is best-effort.** The Decline button does not open the app. If the process is dead,
  expo-notifications can only hand the tap to JavaScript the next time the app starts; until then the server still
  sees a pending call, which times out after 60 s (the caller sees "no answer", not "declined"). When the app is
  alive, Decline reaches the server immediately.
- **A cancelled/expired call's notification can linger** while the process is dead: there is no cancel push. Tapping
  it is handled gracefully ("This call is no longer available") and the notification is cleared. The push TTL (60 s)
  stops FCM from delivering it late.
- **Calling is gated twice.** `isCallingAvailable()` is true only when `EXPO_PUBLIC_FEATURE_CALLS` is exactly `"true"` AND a
  media adapter is registered (`registerCallProvider.ts` registers the Agora adapter only when the SDK and
  `EXPO_PUBLIC_AGORA_APP_ID` are present). Otherwise this build neither rings nor answers: the controller refuses to accept
  a call it cannot join and says so. Decline still works. Connecting a real call has not been verified on a device.

## Agora provider (server)
`_shared/agoraProvider.ts` implements `CallProvider`; `_shared/agoraTokenBuilder.ts` wraps `npm:agora-token@2.0.5`
(RTC token, user-account form, publisher role, at most 120 s). Channel name is `call_<call id>`, account is the verified
user id. `endRoom` is a no-op; call length is enforced by token expiry plus the database lifecycle.

## Deployment (not done)
```bash
supabase db push                       # applies 20260101002700 (enable pg_cron first in the dashboard)
supabase secrets set CALL_PROVIDER=agora AGORA_APP_ID=<32 hex> AGORA_APP_CERTIFICATE=<32 hex>
supabase functions deploy issue-call-token dispatch-push
```
Agora console: create the project with the App Certificate enabled (secured mode). Dashboard: confirm Realtime is on
for `call_events`.

## Known limitations
- Mobile Agora adapter is not implemented. The Realtime subscription, `get_call_sync` wiring, call-push tap/Answer/Decline
  routing and the Android ringing channel were added in Android Phase 3 (see above).
- `is_blocked_pair()` returns false when `auth.uid()` is NULL (service role). The existing like, match and message push
  paths use it, so they do not suppress for blocked pairs; the call path uses its own direct check. Not changed here.
- Unmetered calls are capped by duration only; there is no media heartbeat, so an abandoned unmetered call lives until the cap.
- Provider-side kick/webhooks are not implemented; Agora tokens simply expire.

## Adding a real provider later (needs separate approval)

1. Server: implement `CallProvider` in `_shared/` (SDK and signing stay there), register it in
   `REGISTERED_CALL_PROVIDERS`, set `CALL_PROVIDER` and the provider's secrets with
   `supabase secrets set`. Never put them in the app.
2. Client: implement `CallMediaProvider` (permissions, join, mic, camera, leave, ended event), make
   `getCallMediaProvider` return it, add the native dependency and permissions, build a development
   client.
3. Turn on `EXPO_PUBLIC_FEATURE_CALLS=true` in the EAS environment.
4. Billing and call metering are described in `docs/BILLING.md` (Phase 4). `issue-call-token` now buys
   the next prepaid minute server-side and answers `402 insufficient_coins` when the caller cannot pay.

## Local testing

```powershell
npx jest __tests__/callProvider.test.ts __tests__/callProviderServer.test.ts __tests__/issueCallToken.test.ts __tests__/callToken.test.ts __tests__/callController.test.ts __tests__/callRoutes.test.ts
npm test
npm run lint
cd mobile; npx tsc --noEmit; cd ..
```

The database suite runs only against a disposable local PostgreSQL 16 with the sentinel comment
(see `supabase/tests/README.md`): `bash supabase/tests/run.sh`.
