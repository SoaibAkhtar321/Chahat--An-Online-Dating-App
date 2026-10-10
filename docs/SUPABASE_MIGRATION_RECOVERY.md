# Supabase migration recovery — notes

Baseline: commit `788cf7d`. Nothing here has been applied to the real `milo-dev` project (ref `tuptdzbdowqtmbyhazet`).

## Layout
- `supabase/migrations/` is the ONLY migration source for the Supabase CLI (timestamp ordered: core schema, storage, admin/moderation, mobile hardening).
- `supabase/seed.sql` is development-only demo data (local `supabase db reset`). Never run on production.
- `supabase/functions/delete-account/` — complete account deletion; NOT deployed.
- `drizzle/migrations/` is legacy and superseded (see its README).

## Tunable server settings
`public.app_settings`: `daily_like_limit` (10) and `daily_priority_like_limit` (3). Product decision still unresolved; change rows, not code.

## Deployment prerequisites (manual, needs approval)
1. Confirm Dashboard shows project ref `tuptdzbdowqtmbyhazet`; `supabase link --project-ref tuptdzbdowqtmbyhazet`.
2. `supabase migration list` — if the remote already has tables/history, STOP: the core migration uses plain `CREATE TABLE` and will fail on a non-empty schema. Reconcile first; never mark migrations applied by hand.
3. `supabase db push`, then `supabase functions deploy delete-account`.

## Photo approval / status logic (verified: NOT enforced)
- The photo `status` ("pending" | "approved" | "rejected") exists only inside the client-writable `profiles.photos` JSON. `PhotoUploader` sets `pending`, but the client can write `approved` itself; `profiles_guard` does not protect it.
- No admin approval path exists in the schema or mobile app. `fetchMyProfile` treats a missing status as `approved`.
- `get_discovery_feed`, `get_public_profile` and storage policies do not filter on photo status, so pending/rejected photos are visible to eligible viewers.
- The in-app privacy text says photos undergo approval review — currently inaccurate.
- Suggested fix (not implemented, needs a product decision): a `profile_photos` table (owner, path, status default `pending`) writable only via service_role/admin RPC for status, with feed/storage policies requiring `approved`.

## Remaining security concerns
1. Photo status client-controlled (above); photo `path` values are also client-written, so a user can reference another visible user's photo path as their own (impersonation).
2. Signed URLs (1 h, cached in app) cannot be revoked on block, suspension or deletion until they expire.
3. Uploads are limited only by bucket MIME/size settings; no server-side re-encode or EXIF/GPS stripping.
4. `profiles` SELECT still exposes `likes_you`, `is_demo` and non-onboarded active profiles to signed-in users.
5. `swipes` SELECT lets a user see who liked them (intentional today; would bypass a future paid "Likes you" gate).
6. No rate limiting on messages, reports, uploads or auth.
7. Unmatching or deleting leaves the other party's chat media in storage (delete-account removes only media the deleting user sent).
8. `reports` and an `admin_audit` row (containing the user id) are retained after deletion; confirm against the retention policy / DPDP.
9. `is_blocked_pair`/`has_role` now answer only for the calling user; service-role or SQL-editor calls (auth.uid() NULL) get `false`. Admin code must not rely on them.
10. Column-level grants on `profiles` are explicit: any new profile column needs a new GRANT, or the app cannot read it.
11. Edge Function uses `Access-Control-Allow-Origin: *` (JWT still required) and was not executed (no Deno / real Auth here). Imports `@supabase/supabase-js` from esm.sh, pinned.
12. Auth settings (email confirmation, password rules, OTP rate limits) are not codified in `config.toml`; review in the Dashboard.
13. All DB tests ran on PostgreSQL 16 with stand-ins for Auth/Storage, not on real Supabase.
