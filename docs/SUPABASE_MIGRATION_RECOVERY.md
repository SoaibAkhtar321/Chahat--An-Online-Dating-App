# Supabase migration recovery — notes

Baseline: commit `788cf7d`. Target project: `milo-dev` (ref `tuptdzbdowqtmbyhazet`).

## Layout
- `supabase/migrations/` is the ONLY migration source for the Supabase CLI (timestamp ordered: core schema, storage, admin/moderation, mobile hardening, security followups, privacy and rate limits).
- `supabase/seed.sql` is development-only demo data (local `supabase db reset`). Never run on production.
- `supabase/functions/delete-account/` — complete account deletion; NOT deployed yet (deployed via runbook).
- `drizzle/migrations/` is legacy and superseded (see its README).

## Migration order
1. `supabase/migrations/20260101000000_core_schema.sql` (core roles, profiles, swipes, matches, messages, blocks, reports)
2. `supabase/migrations/20260101000100_storage.sql` (private buckets `photos` & `chat`, folder policies)
3. `supabase/migrations/20260101000200_admin_moderation.sql` (admin audit log, suspension messaging guard)
4. `supabase/migrations/20260101000300_mobile_security_hardening.sql` (quota limits, 2-arg record_swipe, purge_user_data RPC, dob locking)
5. `supabase/migrations/20260101000400_security_followups.sql` (photo path ownership, search_path = public, pg_temp on SECURITY DEFINER functions)
6. `supabase/migrations/20260101000500_privacy_and_rate_limits.sql` (remove is_demo and likes_you from feed & profiles grant, revoke demo_reply from authenticated, rate limit triggers on messages and reports)

## Tunable server settings
`public.app_settings`: `daily_like_limit` (10) and `daily_priority_like_limit` (3). Modifiable via service_role SQL without code changes.

## Deployment prerequisites (manual, needs approval)
1. Confirm Dashboard shows project ref `tuptdzbdowqtmbyhazet`; `supabase link --project-ref tuptdzbdowqtmbyhazet`.
2. Run read-only verification checks (`supabase/verification/remote_readonly_checks.sql`) before applying changes.
3. `supabase migration list` — if the remote already has tables/history, STOP: the core migration uses plain `CREATE TABLE` and will fail on a non-empty schema. Reconcile first; never mark migrations applied by hand or use `migration repair`.
4. Run `supabase db push --dry-run`, then `supabase db push` (DO NOT pass `--include-seed`), then `supabase functions deploy delete-account`.
5. Run post-deploy checks (`supabase/verification/post_deploy_checks.sql`).

## Resolved security items
1. **Storage pagination fixed**: `removeFolder` in `delete-account` loops up to 50 pages of 100 items each.
2. **Strict storage deletion guard**: `removeFolder` throws if files remain after pagination limit instead of exiting silently.
3. **Cross-user chat media cleanup**: `delete-account` purges all `chat/<matchId>/*` files across both participants.
4. **Photo path ownership enforced**: `profiles_guard` rejects photo paths not matching `<user_id>/%`.
5. **Function search_path hardened**: All `SECURITY DEFINER` functions in `public` specify `SET search_path = public, pg_temp`.
6. **Feed and column privacy**: `is_demo` and `likes_you` removed from `get_discovery_feed` and revoked from `authenticated` on `profiles`.
7. **Rate limits added**: 30 messages/minute per sender; 10 reports/hour per reporter.
8. **demo_reply restricted**: Revoked from `authenticated` (executable only by `service_role`).

## Remaining security concerns & open items (Honest status)
1. **Photo approval not enforced**: Photo `status` exists in client-writable JSON; no admin approval review pipeline exists. In-app privacy copy was reworded to match reality instead of claiming manual verification.
2. **Signed URLs**: Generated photo/chat signed URLs (1 hour expiry) cannot be revoked prematurely upon block, suspension, or deletion until they expire naturally.
3. **No EXIF stripping / server re-encode**: Uploads are restricted only by bucket MIME and size limits; client metadata (EXIF/GPS) is not stripped server-side.
4. **No upload rate limiting**: Only messages and reports are rate-limited; photo uploads lack rolling count rate limits.
5. **Retained data**: Moderation reports and one `admin_audit` record (`account_self_deleted` with user id) are retained after account deletion for audit and moderation reasons.
6. **Auth configuration**: Email confirmation, password strength, and OTP rate limit rules are not codified in `config.toml` (must be checked in Supabase Dashboard Auth settings).
7. **Test environment scope**: All CI and local database tests ran on plain PostgreSQL 16 with Supabase schema/role stand-ins, not against a live Supabase cloud environment.
