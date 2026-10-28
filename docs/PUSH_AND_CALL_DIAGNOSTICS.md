# Push notifications, call ringtone and video calls: diagnostics (2026-10-29)

## 1. Video calls say "Calling isn't available in this build"
The call screen now adds a **Details:** line saying exactly why:

| Details text | Cause | Fix |
|---|---|---|
| Calls are switched off in this build (EXPO_PUBLIC_FEATURE_CALLS) | The build did not get the calls flag | Build with `--profile preview` (or production) from `mobile/`; check `eas.json` has `EXPO_PUBLIC_FEATURE_CALLS: "true"` and that no EAS **environment variable** of the same name is set to something else (expo.dev → project → Environment variables) |
| The Agora App ID was not included in this build | `EXPO_PUBLIC_AGORA_APP_ID` missing | Same as above, for `EXPO_PUBLIC_AGORA_APP_ID` |
| The calling SDK failed to load: … | The Agora native module did not start on the phone | Send the full Details line; it names the exact error |

## 2. No push notifications / no ringtone when the app is closed
The incoming-call ringtone arrives *inside* the push notification, so if pushes do not arrive the ringtone cannot play.
Run these **read-only** checks in Supabase → SQL Editor and send the results.

```sql
-- A. Does this phone have a push token registered? (one row per phone; active must be true)
select platform, active, app_version, last_seen_at from public.push_devices order by last_seen_at desc limit 10;

-- B. Are notifications being created and sent? (status 'submitted'/'delivered' = sent; look at last_error)
select o.category, d.status, d.last_error, d.attempt_count, o.created_at
from public.notification_outbox o left join public.notification_deliveries d on d.notification_id = o.id
order by o.created_at desc limit 15;

-- C. Can the database call the dispatch-push function? Both names must be listed.
select name from vault.secrets where name in ('chahat_project_url', 'chahat_push_dispatch_secret');
select extname from pg_extension where extname in ('pg_net', 'pg_cron');

-- D. What did dispatch-push answer? (200 = OK, 401 = secret mismatch, 404 = function missing)
select status_code, left(content::text, 120) as body, created from net._http_response order by created desc limit 5;
```

How to read it:
* **A is empty** → the app never registered: in the app open Settings → Notifications, switch it off and on, and read
  the message. Also check the build has `google-services.json` (EAS file variable `GOOGLE_SERVICES_JSON` in the
  **preview** environment, not only production) and the FCM V1 key is uploaded in `eas credentials`.
* **B has rows with no delivery / status pending** and **C lists fewer than 2 names** → the database cannot trigger
  sending. Set the two vault secrets (the second value must equal the Edge Function secret `PUSH_DISPATCH_SECRET`;
  choose a new random value and set it in both places):
  ```sql
  select vault.create_secret('https://tuptdzbdowqtmbyhazet.supabase.co', 'chahat_project_url');
  select vault.create_secret('<NEW_RANDOM_VALUE>', 'chahat_push_dispatch_secret');
  ```
  ```powershell
  npx supabase secrets set PUSH_DISPATCH_SECRET=<NEW_RANDOM_VALUE> --project-ref tuptdzbdowqtmbyhazet
  ```
* **D shows 401** → the two secret values differ: set both again to the same new value.
* **B shows status failed with last_error like DeviceNotRegistered / InvalidCredentials** → FCM credentials in EAS
  (`eas credentials` → Android → FCM V1 service account key) are missing or wrong.
