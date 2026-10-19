# Push Notification Setup (attach later)

The architecture is complete. Push stays **off** until you do the steps below. While off:
- the app never asks for notification permission and never registers a device
  (`registerPushNotificationToken` returns `not_configured`),
- `dispatch-push` answers `503 push_not_configured` if its secrets are missing,
- a provider credential error never deactivates a device (only `DeviceNotRegistered` does).

## Steps, in order

1. **Decide the package ID first** (`docs/RELEASE_DECISIONS.md`). Firebase ties the Android app to it.
2. **Firebase:** create a project, add an Android app with that package ID, download `google-services.json`.
3. **Put the file in the build** (it is gitignored, never commit it), either:
   - local: copy it to `mobile/google-services.json`, or
   - EAS: `eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production`
   `mobile/app.config.js` adds `android.googleServicesFile` only when the file exists.
4. **EAS credentials:** upload the Firebase FCM V1 service account key (`eas credentials`, Android, Google Service Account Key for FCM V1).
5. **Server:** set `PUSH_DISPATCH_SECRET`, deploy `dispatch-push`, and schedule it with `pg_cron`
   exactly as in `docs/DEPLOYMENT_RUNBOOK.md` (section on the dispatch worker). Use the same secret in
   the Edge Function secret and Vault.
6. **Turn it on:** set `EXPO_PUBLIC_FEATURE_PUSH=true` in the EAS production environment and rebuild.

## Check it works
Install the new build on a physical Android phone, sign in, accept the permission, and trigger a
match or message from a second account. Inspect `notification_deliveries` (status, `last_error`).
Emulators cannot receive real pushes.

## What each push contains (Phase 1)
| Event | Fired by (database, after the row is committed) | Lock-screen text | Tap opens |
|---|---|---|---|
| Match | `matches` insert, once per user | "It's a match!" (+ partner first name unless hidden) | that chat |
| Message | `messages` insert (not `system` rows) | sender first name + "Sent you a message", or a 80-char preview if opted in | that chat |
| Like / priority like | `swipes` insert, only if not already matched | "Someone likes you" - never the sender | Likes tab |

- Lock-screen detail is per user (`notification_preferences.lock_screen_details`: `none`, `name` (default),
  `preview`), read by the dispatcher at send time through the service-role-only
  `get_push_display_context()`. Message text is never stored in the outbox. Photos, voice and
  view-once messages are never quoted.
- Duplicates are impossible at the key level: `UNIQUE (recipient_id, category, event_id)` on the outbox and
  `UNIQUE (notification_id, device_id)` on deliveries.
- Blocks, suspension, disabled categories and deleted conversations are re-checked at send time
  (`_pair_blocked`, which works without an `auth.uid()`), so an event enqueued before a block is suppressed.
- Foreground: a push for the chat that is currently open is not shown. Background/killed: the OS shows it;
  tapping validates the match belongs to the signed-in user before opening it.
- Delivery latency equals the scheduler interval. `pg_cron` runs at best every minute on standard plans
  (sub-minute needs a recent pg_cron); a database webhook on `notification_outbox` insert that calls
  `dispatch-push` gives near-instant delivery and is safe because dispatch is idempotent.
- Run `supabase functions deploy dispatch-push --no-verify-jwt` again after this phase (index.ts and policy.ts changed).

## Phase 2: "Someone likes you" push and the Premium gate

- The like push is generic ("Someone likes you") and carries only `category` and `notificationId`.
  It never contains the liker's id, name or photo; `route_data` for likes is empty.
- A like only notifies while it is **valid**: it exists, is non-mutual and unanswered (the recipient has
  not liked back or passed), is not blocked, and both accounts are active and onboarded. That single
  rule is `public._like_is_valid()`; the trigger, the list, the count and delivery-time suppression
  (`LikeNoLongerValid` in `claim_push_deliveries`) all use it.
- Duplicates/retries: the outbox event id is the deterministic pair `from:to`, so replays hit the unique
  key and do nothing; an in-flight delivery is not re-claimed.
- On tap, the app calls `get_my_likes_access()` every time (free members get `{"eligible": false}` only, no count). Eligible members open `/(tabs)/likes`,
  others open the existing `/premium` paywall. If the check fails the app shows an alert and does not
  navigate. The tap never trusts the push payload or a cached tier.
- Migration: `20260101003800_phase2_premium_likes_flow.sql` (apply after `...003700`). Not yet applied
  to any hosted project.
