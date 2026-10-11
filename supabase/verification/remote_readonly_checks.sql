-- ============================================================================
-- supabase/verification/remote_readonly_checks.sql
-- SELECT-only inspection queries for the Supabase Dashboard SQL Editor.
-- Safely inspects remote database state prior to running migrations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Check existing migration history table
-- Healthy pre-deploy state on fresh project: Table does not exist (0 rows in pg_class).
-- If this table exists and has rows, STOP: do not run `supabase db push` until reconciling.
-- ----------------------------------------------------------------------------
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  CASE
    WHEN c.relname IS NOT NULL THEN 'Migration table exists — verify rows before deploying'
    ELSE 'No migration history table found (healthy fresh state)'
  END AS status
FROM (SELECT 1) _
LEFT JOIN pg_class c ON c.relname = 'schema_migrations'
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'supabase_migrations';

DO $$
DECLARE
  rec record;
  found_history boolean := false;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    FOR rec IN EXECUTE 'SELECT version, inserted_at FROM supabase_migrations.schema_migrations ORDER BY version' LOOP
      found_history := true;
      RAISE NOTICE 'Found recorded migration: % (applied %)', rec.version, rec.inserted_at;
    END LOOP;
    IF NOT found_history THEN
      RAISE NOTICE 'supabase_migrations.schema_migrations exists but is empty.';
    END IF;
  ELSE
    RAISE NOTICE 'supabase_migrations.schema_migrations does not exist (healthy pre-deploy state).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Tables in public schema & Row Level Security flags
-- Healthy pre-deploy state: 0 user application tables.
-- Healthy post-deploy state: all tables (profiles, swipes, matches, messages,
-- blocks, reports, user_roles, user_daily_quotas, app_settings, admin_audit)
-- present with rls_enabled = true.
-- ----------------------------------------------------------------------------
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- ----------------------------------------------------------------------------
-- 3. Row Level Security policies in public
-- Healthy pre-deploy state: 0 policies.
-- Healthy post-deploy state: policies defined for profiles, user_roles, swipes,
-- matches, messages, blocks, reports, user_daily_quotas, and admin_audit.
-- ----------------------------------------------------------------------------
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ----------------------------------------------------------------------------
-- 4. Triggers in public
-- Healthy post-deploy state: triggers defined for profiles_guard,
-- messages_sender_active, check_message_rate_limit, check_report_rate_limit,
-- and on_auth_user_created.
-- ----------------------------------------------------------------------------
SELECT
  event_object_table AS table_name,
  trigger_name,
  event_manipulation AS event,
  action_timing AS timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- ----------------------------------------------------------------------------
-- 5. Functions in public with permissions (proacl) and search_path (proconfig)
-- Healthy post-deploy state: all SECURITY DEFINER functions have proconfig
-- containing search_path=public, pg_temp.
-- ----------------------------------------------------------------------------
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS is_security_definer,
  p.proconfig AS config_settings,
  p.proacl AS access_privileges
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- ----------------------------------------------------------------------------
-- 6. Storage buckets & privacy flags
-- Healthy post-deploy state: 'photos' and 'chat' buckets exist with public = false.
-- ----------------------------------------------------------------------------
SELECT
  id,
  name,
  public AS is_public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
ORDER BY id;

-- ----------------------------------------------------------------------------
-- 7. Realtime publication tables
-- Healthy post-deploy state: tables configured for realtime listeners.
-- ----------------------------------------------------------------------------
SELECT
  schemaname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- ----------------------------------------------------------------------------
-- 8. Row counts ONLY for auth.users and storage.objects (no private row data leaked)
-- Healthy pre-deploy state: 0 (or disposable tester account).
-- ----------------------------------------------------------------------------
SELECT 'auth.users' AS table_source, count(*) AS total_rows FROM auth.users
UNION ALL
SELECT 'storage.objects' AS table_source, count(*) AS total_rows FROM storage.objects;

-- ----------------------------------------------------------------------------
-- 9. Installed PostgreSQL extensions
-- Healthy state: includes standard Supabase extensions (pgcrypto, uuid-ossp, etc.).
-- ----------------------------------------------------------------------------
SELECT
  extname AS extension_name,
  extversion AS installed_version
FROM pg_extension
ORDER BY extname;
