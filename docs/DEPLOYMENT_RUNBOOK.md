# Milo Deployment Runbook

Target Project: `milo-dev` (Ref: `tuptdzbdowqtmbyhazet`)  
Working Directory: `<repository-root>`  
Shell: **Windows PowerShell** (or **Bash** on Linux/macOS)

---

## Step 1: Local Pre-flight Verification

Execute all local automated checks and the database regression suite using Docker.

```powershell
# 1.1 Root dependencies, linting, and unit tests
npm ci
npm test -- --ci
npm run lint

# 1.2 Mobile dependencies and TypeScript typecheck
cd mobile
npm ci
cd ..
npm run build

# 1.3 Database security and regression suite via scratch PostgreSQL 16
docker run --name milo-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 -d postgres:16

# On Windows PowerShell with WSL:
$wslRepo = wsl wslpath -a (Get-Location).Path
wsl bash -lc "cd `"$wslRepo/supabase/tests`" && PGHOST=localhost PGPORT=5433 PGUSER=postgres PGPASSWORD=postgres bash run.sh"

# Alternatively, on native Linux / macOS (Bash):
# cd supabase/tests && PGHOST=localhost PGPORT=5433 PGUSER=postgres PGPASSWORD=postgres bash run.sh

docker rm -f milo-pg
```

**Expected Result:**

```text
RESULT: ALL DATABASE TESTS PASSED
```

_(Note: Passing on scratch PostgreSQL verifies migration syntax and security logic with stand-ins, but does not prove real-Supabase runtime behaviour.)_

---

## Step 2: Real Supabase Locally (Local Environment ONLY)

Test migrations and the Edge Function against the official local Supabase emulator.

> **CRITICAL WARNING:** NEVER run `supabase db reset --linked`. Only run `supabase db reset` locally without any flags.

```powershell
# 2.1 Start local Supabase and apply migrations + seed
supabase start
supabase db reset

# 2.2 Serve delete-account Edge Function locally
supabase functions serve delete-account --no-verify-jwt
```

**Disposable Account Deletion Test (Local):**

1. Create a temporary test account in the local app/Auth UI.
2. Trigger account deletion via the app UI (Settings > Delete Account > Type `DELETE`).
3. Interrupt the process or simulate partial failure (e.g., stop the function after storage deletion).
4. Re-invoke deletion and verify it completes idempotently and removes the Auth user and database rows.

---

## Step 3: Remote Read-Only Inspection

Inspect the live remote database using read-only queries before linking or applying migrations.

### 3.1 Verify Project Reference in Mobile Configuration

Run this PowerShell command to extract ONLY the host of your configured Supabase URL (never print the secret keys):

```powershell
(Get-Content mobile/.env | Select-String "EXPO_PUBLIC_SUPABASE_URL") -replace '.*https?://([^/]+).*', '$1'
```

**Expected Result:**
The output host string **MUST** contain:

```text
tuptdzbdowqtmbyhazet.supabase.co
```

### 3.2 Run Pre-deployment Checks in Supabase Dashboard

1. Open the [Supabase Dashboard](https://supabase.com/dashboard/project/tuptdzbdowqtmbyhazet).
2. Go to the **SQL Editor**.
3. Paste and run the contents of `supabase/verification/remote_readonly_checks.sql`.

---

## Step 4: GO / NO-GO Decision Gate

Review the results from `remote_readonly_checks.sql`:

- **GO Criteria:**
  - `supabase_migrations.schema_migrations` does NOT exist or has 0 recorded rows.
  - No application tables exist in the `public` schema.
  - Zero application storage objects exist.
- **NO-GO / STOP Criteria:**
  - Any application tables or existing migrations already exist on the remote database.
  - **Action if NO-GO:** STOP immediately. Do NOT run `supabase db push`. Reconcile schema differences manually. **NEVER use `supabase migration repair`**.

---

## Step 5: Production Deployment

Proceed ONLY after a confirmed **GO** status.

```powershell
# 5.1 Authenticate with Supabase CLI
supabase login

# 5.2 Link project (enter database password when prompted)
supabase link --project-ref tuptdzbdowqtmbyhazet

# 5.3 Review remote migration status
supabase migration list

# 5.4 Perform dry-run push
supabase db push --dry-run

# 5.5 Apply migrations to remote database (DO NOT use --include-seed)
supabase db push

# 5.6 Deploy Edge Functions
# Configure these values as Supabase Edge Function secrets before deployment; never commit or print them:
# GOOGLE_PLAY_PACKAGE_NAME=com.milo.dating
# GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL=<service account with Android Publisher API access>
# GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY=<service account private key>
# The Play Console API must be enabled and the service account granted access to this app.
# The future Billing client must set obfuscatedAccountId to lowercase SHA-256 hex of the Supabase user UUID.
# verify-purchase rejects purchases without that matching account binding.
# Pending payment states are not entitled or acknowledged. A verified completed purchase is persisted
# before acknowledgement; same-account retries are idempotent, while cross-account/stale/downgrade
# replays are rejected.
# Also configure SUPABASE_SERVICE_ROLE_KEY and GOOGLE_VISION_API_KEY as remote secrets.
supabase functions deploy delete-account
supabase functions deploy verify-purchase
supabase functions deploy moderate-photo
supabase functions deploy dispatch-push --no-verify-jwt
```

**Migration Sequence Applied:**

1. `20260101000000_core_schema.sql`
2. `20260101000100_storage.sql`
3. `20260101000200_admin_moderation.sql`
4. `20260101000300_mobile_security_hardening.sql`
5. `20260101000400_security_followups.sql`
6. `20260101000500_privacy_and_rate_limits.sql`
7. `20260101000600_trigger_function_hardening.sql`
8. `20260101000700_subscription_entitlements_and_like_security.sql`
9. `20260101000800_photo_visibility_stopgap.sql`
10. `20260101000900_photo_reviews.sql`
11. `20260101001000_photo_visibility_approved_only.sql`
12. `20260101001100_uniform_like_quota.sql`
13. `20260101001200_daily_like_limit_20.sql`
14. `20260101001300_critical_security_foundations.sql`
15. `20260101001400_harden_verification_metadata_guard.sql`
16. `20260101001500_subscription_orders_and_replay_protection.sql`
17. `20260101001600_google_play_verified_purchase_expiry.sql`
18. `20260101001700_profile_completion_and_media_guard.sql`
19. `20260101001800_push_notifications.sql`

---

## Step 6: Post-Deployment Verification

### 6.1 Run Verification Queries

1. Return to the Supabase Dashboard SQL Editor for `tuptdzbdowqtmbyhazet`.
2. Paste and run the contents of `supabase/verification/post_deploy_checks.sql`.
3. Verify that all 11 checks return `true` / `all valid` / `none`.

### 6.2 Disposable Account Verification on Live System

1. Sign up a temporary disposable account through the mobile app.
2. Complete onboarding, upload a test profile photo, and send a message.
3. Delete the test account via Settings > Delete Account (confirm with `DELETE`).
4. Confirm user data, storage files, and auth record are purged cleanly.
5. Confirm remaining users can log in, view discovery feed (without `is_demo` / `likes_you` errors), and swipe normally.

---

## Phase 3: Expo Push Notifications (Setup Only — Not Deployed)

This repository uses Expo Push Notifications with the EAS project ID already configured in
`mobile/app.json`: `d40a4e1f-fbf8-4b44-93af-7c4e1fe39b8a`. The mobile app has no push-provider
secret or additional `EXPO_PUBLIC_*` variable. Push tokens are registered through authenticated
database RPCs; raw tokens are inaccessible to authenticated clients. Database triggers write safe
event identifiers to an outbox. The `dispatch-push` Edge Function sends generic lock-screen text,
and a periodic worker polls Expo receipts. A provider ticket is recorded as **submitted**, not
delivered; only a successful receipt is recorded as delivered.

### Local and provider setup

1. Install dependencies and run checks from the repository root:

   ```powershell
   npm ci
   cd mobile
   npm ci
   npx expo install --check
   cd ..
   npm test -- --ci
   npm run build
   npm run lint
   ```

2. Keep the Supabase app URL/key in the existing local mobile environment. There are no new mobile
   secrets. Do not place `PUSH_DISPATCH_SECRET`, an Expo access token, FCM service-account JSON, or
   APNs private keys in the app or an `EXPO_PUBLIC_*` variable.
3. In the EAS account that owns the configured project, configure Android FCM v1 credentials and an
   Apple APNs authentication key using `eas credentials --platform android` and
   `eas credentials --platform ios`. Use provider-issued credentials in EAS only; do not commit
   credential files.
4. Build and install a development/production app on a physical Android and iOS device. Remote
   push delivery is not verified by a simulator, web, or a mocked Jest test.

### Deploying the backend (do not run as part of this phase)

After reviewing the target project, migration history, and dashboard state using the existing GO /
NO-GO procedure:

```powershell
supabase link --project-ref tuptdzbdowqtmbyhazet
supabase migration list
supabase db push --dry-run
# Only after explicit deployment approval and a confirmed safe migration plan:
supabase db push
supabase secrets set PUSH_DISPATCH_SECRET="<generate-a-random-32-byte-or-longer-secret>"
supabase functions deploy dispatch-push --no-verify-jwt
```

The dispatch function requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the Supabase
Edge Function environment plus `PUSH_DISPATCH_SECRET`. The function intentionally disables JWT
verification because it is called by a database scheduler; it rejects every request without the
matching high-entropy `x-dispatch-secret` header. Store the same secret in Supabase Vault for the
database scheduler, never in a mobile build or SQL migration.

Enable `pg_cron`, `pg_net`, and Vault in the Supabase project, then schedule the worker once per
minute in the Supabase SQL Editor. Replace placeholders, generate the secret out of band, and enter
the identical value in the Edge Function secret and Vault. Never paste real secrets into source
control or task logs:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select vault.create_secret('https://<project-ref>.supabase.co', 'chahat_project_url');
select vault.create_secret('<same-random-dispatch-secret>', 'chahat_push_dispatch_secret');

select cron.schedule(
  'dispatch-chahat-push-notifications',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'chahat_project_url') || '/functions/v1/dispatch-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets
                           where name = 'chahat_push_dispatch_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);
```

Confirm the cron job is active and inspect recent `cron.job_run_details` entries. Also monitor
`notification_deliveries` by status and `last_error`; `DeviceNotRegistered` tokens are deactivated
automatically. Provider 429/5xx/network failures are retried with bounded exponential backoff.
Events are transactionally deduplicated by recipient, event, and category, and each event/device
delivery is unique. A connection loss after Expo accepted a request but before the server received
the response is inherently ambiguous and may cause a duplicate on retry.

### Device verification checklist

1. Install a fresh physical-device build, sign in, grant notification permission, and verify that
   a real `ExponentPushToken[...]` is registered for the authenticated account. No mock token is
   accepted by the registration RPC.
2. In Settings, disable and re-enable each category; confirm the preference row changes and the
   server-created outbox does not dispatch disabled categories.
3. Deny permission on a fresh install. Confirm no token is registered and the app offers a system
   settings link without repeatedly requesting permission. Enable it in OS settings and reopen the
   app to register.
4. With two test accounts and two physical devices, create a like, mutual match, and message. Confirm
   only eligible recipients receive generic text, no message body or profile details appear on the
   lock screen, and a tap opens only a currently authorized match/chat. Test both foreground and
   terminated-app cold start.
5. Unmatch/block/delete the test account and confirm inaccessible destinations show the unavailable
   message. Sign out and verify the device token is removed; account deletion cascades token removal.

This phase adds server-side event recording, token authorization, and provider receipt tracking but
does not deploy the migration, Edge Function, scheduler, or EAS provider credentials. Real delivery
and Android/iOS deep-link behavior remain unverified until the above setup is completed on
authorized non-production test accounts and physical devices.
