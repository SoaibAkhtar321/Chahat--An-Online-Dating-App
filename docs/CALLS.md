# Calls: provider architecture (Phase 3)

Status: the server and client plumbing is complete and tested. **No call provider is integrated.**
Until one is added, calling is reported as unavailable and no control implies a connection.

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

## Adding a real provider later (needs separate approval)

1. Server: implement `CallProvider` in `_shared/` (SDK and signing stay there), register it in
   `REGISTERED_CALL_PROVIDERS`, set `CALL_PROVIDER` and the provider's secrets with
   `supabase secrets set`. Never put them in the app.
2. Client: implement `CallMediaProvider` (permissions, join, mic, camera, leave, ended event), make
   `getCallMediaProvider` return it, add the native dependency and permissions, build a development
   client.
3. Turn on `EXPO_PUBLIC_FEATURE_CALLS=true` in the EAS environment.
4. Phase 4 adds billing and call duration metering; this phase does not charge or meter anything.

## Local testing

```powershell
npx jest __tests__/callProvider.test.ts __tests__/callProviderServer.test.ts __tests__/issueCallToken.test.ts __tests__/callToken.test.ts __tests__/callController.test.ts __tests__/callRoutes.test.ts
npm test
npm run lint
cd mobile; npx tsc --noEmit; cd ..
```

The database suite runs only against a disposable local PostgreSQL 16 with the sentinel comment
(see `supabase/tests/README.md`): `bash supabase/tests/run.sh`.
