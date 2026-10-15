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
# Note: Ensure SUPABASE_SERVICE_ROLE_KEY and GOOGLE_VISION_API_KEY are configured in remote secrets
supabase functions deploy delete-account
supabase functions deploy verify-purchase
supabase functions deploy google-play-notifications
supabase functions deploy moderate-photo
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
17. `20260101001900_location_discovery.sql`
18. `20260101002000_video_call_lifecycle.sql`
19. `20260101002100_google_play_verification_hardening.sql`

The migration number gap is intentional: separate local phase worktrees use the intervening
timestamps. Before combining those branches, confirm that every migration filename is unique and
that the final order is reviewed. These three migrations are local-only until explicitly deployed.

---

## Location, Calls, and Google Play Billing (local implementation)

### Location and discovery

- `expo-location` is foreground-only. The app asks only after a user presses the location control
  and explains the purpose. A denied permission is not repeatedly prompted; use device Settings to
  grant it later.
- `discovery_locations` stores precise coordinates in a private table with no client table grants.
  Only the authenticated user's set/clear/status RPCs are exposed. The discovery RPC returns rounded
  distance, never coordinates, and only uses location records updated in the last 72 hours.
- Use the disposable PostgreSQL suite for the `39_location_discovery.sql` regressions. Do not run
  the migration against a linked/production Supabase project as part of local validation.

### Video calls

- The lifecycle RPCs create matched, unblocked, eligible-member invitations and enforce call-state
  transitions. A free-call cap starts when the invite is accepted: 60 seconds if either participant
  is on the free tier; otherwise no free-tier cap applies. This follows the app's existing
  “first minute of every call is free” wording.
- Agora/ZEGOCLOUD has not been selected or configured. No provider SDK, media room, or join token is
  created. The UI explicitly reports that a request is not a live call. Calls can be manually
  refreshed in the Calls screen because the separate push-notification phase is not in this
  committed baseline; reconcile that integration when the phase branches are combined.
- Run `40_video_calls.sql` only through the fail-closed disposable PostgreSQL runner.

### Google Play subscriptions

- Server verification supports only the six approved `chahat_*` Google Play products. Tier and
  expiry are derived from the Google Android Publisher API response; client-supplied prices, tiers,
  and durations are ignored. Pending transactions are not entitled or acknowledged. The native
  client acknowledges a completed purchase only after the verified purchase has been persisted.
- Before enabling billing, create/publish the matching subscription products and base plans in Play
  Console, link the Android Publisher API to the app, and configure a restricted service account
  with subscription-read access. Store its JSON only as Supabase secret
  `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Never use an `EXPO_PUBLIC_*` variable for this credential.
- `EXPO_PUBLIC_FEATURE_BILLING` defaults to false. Set it to `true` only in a store-connected
  Android build after the server secret, package name (`com.milo.dating`), product catalog, and
  test-track accounts are ready. The app uses Google Play localized pricing, not the reference
  rupee values in the product copy.
- `react-native-iap` requires a new native development/store build; Expo Go cannot exercise Google
  Play Billing. Test pending/cancelled/purchased/replayed/restored states with Play license testers.
- The verifier is deployed with the repository's existing `verify-purchase` Edge Function name.
  Deploy the migration and function together only after reviewing the remote migration history;
  neither was deployed or tested against live Supabase in this implementation.
- `google-play-notifications` is configured with `verify_jwt = false` because Supabase JWTs cannot
  authenticate Google Pub/Sub pushes. The handler validates the Google OIDC JWT signature against
  Google's JWKS and checks issuer, exact audience, verified service-account email, issue time, and
  expiry before parsing the notification. Configure the Supabase secrets
  `PUBSUB_PUSH_AUDIENCE` (the exact HTTPS function URL) and
  `PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL` (the dedicated Pub/Sub push-auth service account email),
  in addition to `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. In Google Cloud, enable authenticated push on
  the Pub/Sub subscription, set its audience to the exact function URL, grant the Pub/Sub service
  agent `roles/iam.serviceAccountTokenCreator` on the push-auth service account when required by
  the project, and connect the Play Console RTDN topic to the subscription. Supabase invocation is
  authorized by the verified OIDC claims rather than Google Cloud IAM on the Supabase endpoint.
  The handler re-fetches the subscription from Android Publisher API and reconciles only purchases
  already associated with a Chahat account; RTDN payload fields never directly grant entitlements.
  Validate the Pub/Sub delivery against a non-production project before configuring production.

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
