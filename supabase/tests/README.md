# Database security suite

Entry point: `bash supabase/tests/run.sh` (needs `psql` and a **disposable** local PostgreSQL 16; it drops and recreates `milo_test_func` and `milo_test_conc`). It refuses a non-local `PGHOST` unless `ALLOW_NONLOCAL_DB=1`.
Env: `PGHOST` (default `localhost`; may be a socket dir), `PGPORT`, `PGUSER`, `PGPASSWORD`, `MIGRATIONS_DIR` (default `../migrations`, applied in lexical order; `../seed.sql` is applied only if it exists).
Order: stand-ins, migrations, `10_functional_rls.sql`, `20_storage_deletion.sql`, `90_assert.sql` (needs at least 50 recorded checks), then a fresh DB with `30_concurrency_setup.sql` and `40_concurrency.sh`.

## What the stand-ins (`00_supabase_standins.sql`) reproduce
Roles `anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()`/`auth.role()` driven by `request.jwt.claim.*` settings, default table/function grants to those roles, minimal `storage.buckets`/`storage.objects`/`storage.foldername`, and a `supabase_realtime` publication.

## What they do NOT reproduce
Real Supabase Auth (JWT verification, `auth.users` columns/triggers), the real Storage service and its policies/buckets, PostgREST behaviour, Supabase's real default privileges, extensions and roles, and the **actual remote schema**. A pass here is not evidence that the Supabase project is secure; a fail shows the committed SQL does not meet the suite's expectations.

## Known state
The migration history is unified and timestamp-ordered in `supabase/migrations/`:
1. `20260101000000_core_schema.sql`
2. `20260101000100_storage.sql`
3. `20260101000200_admin_moderation.sql`
4. `20260101000300_mobile_security_hardening.sql`
5. `20260101000400_security_followups.sql`
6. `20260101000500_privacy_and_rate_limits.sql`
7. `20260101000600_trigger_function_hardening.sql`

Legacy Drizzle migration files in `drizzle/migrations/` are superseded and kept for historical reference only. CI runs directly against `supabase/migrations/` and `supabase/seed.sql`.
