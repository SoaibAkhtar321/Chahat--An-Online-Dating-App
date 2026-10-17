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
- the Calls screen shows "Audio and video calling is not available yet" instead of call buttons;
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
- Mobile Agora adapter, Realtime subscription, `get_call_sync` wiring, call-push tap routing
  (`resolveNotificationDestination` returns null for `call`) and an Android ringing channel are not implemented.
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
