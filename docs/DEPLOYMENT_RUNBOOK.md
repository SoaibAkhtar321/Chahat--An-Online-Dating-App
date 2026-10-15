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
*(Note: Passing on scratch PostgreSQL verifies migration syntax and security logic with stand-ins, but does not prove real-Supabase runtime behaviour.)*

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
17. `20260101001700_profile_completion_and_media_guard.sql`

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
