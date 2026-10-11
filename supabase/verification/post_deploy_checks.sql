-- ============================================================================
-- supabase/verification/post_deploy_checks.sql
-- SELECT-only assertions to verify remote schema and security hardening
-- immediately after running `supabase db push`.
-- All queries should return TRUE / PASS status.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. All expected application tables exist with Row Level Security enabled
-- Expected: Every row returns true.
-- ----------------------------------------------------------------------------
SELECT
  expected_table,
  EXISTS(
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = expected_table AND c.relrowsecurity = true
  ) AS exists_with_rls_enabled
FROM (
  VALUES
    ('profiles'),
    ('user_roles'),
    ('swipes'),
    ('matches'),
    ('messages'),
    ('blocks'),
    ('reports'),
    ('user_daily_quotas'),
    ('app_settings'),
    ('admin_audit')
) AS t(expected_table);

-- ----------------------------------------------------------------------------
-- 2. Storage buckets are configured and private
-- Expected: Both 'photos' and 'chat' return is_private = true.
-- ----------------------------------------------------------------------------
SELECT
  id AS bucket_name,
  (public = false) AS is_private
FROM storage.buckets
WHERE id IN ('photos', 'chat')
ORDER BY id;

-- ----------------------------------------------------------------------------
-- 3. Legacy delete_user_account RPC is dropped (replaced by Edge Function)
-- Expected: Returns true.
-- ----------------------------------------------------------------------------
SELECT
  NOT EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'delete_user_account'
  ) AS delete_user_account_rpc_is_dropped;

-- ----------------------------------------------------------------------------
-- 4. purge_user_data RPC is executable ONLY by service_role
-- Expected: anon_can_execute = false, authenticated_can_execute = false,
-- service_role_can_execute = true.
-- ----------------------------------------------------------------------------
SELECT
  p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'purge_user_data';

-- ----------------------------------------------------------------------------
-- 5. record_swipe RPC has ONLY the 2-argument signature (_to text, _kind text)
-- Expected: exactly_one_signature = true, is_two_arg_signature = true.
-- ----------------------------------------------------------------------------
SELECT
  count(*) = 1 AS exactly_one_signature,
  bool_and(pg_get_function_identity_arguments(p.oid) = '_to text, _kind text') AS is_two_arg_signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'record_swipe';

-- ----------------------------------------------------------------------------
-- 6. Every SECURITY DEFINER function in public has pg_temp in search_path
-- Expected: all_secdef_functions_contain_pg_temp = true, unhardened_functions = 'all valid'.
-- ----------------------------------------------------------------------------
SELECT
  count(*) = 0 AS all_secdef_functions_contain_pg_temp,
  coalesce(string_agg(p.proname, ', '), 'all valid') AS unhardened_functions
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef = true
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(p.proconfig) cfg
    WHERE cfg LIKE 'search_path=%' AND cfg LIKE '%pg_temp%'
  );

-- ----------------------------------------------------------------------------
-- 7. Role 'anon' has NO table privileges in schema public
-- Expected: anon_has_zero_table_privileges = true, leaked_privileges = 'none'.
-- ----------------------------------------------------------------------------
SELECT
  count(*) = 0 AS anon_has_zero_table_privileges,
  coalesce(string_agg(table_name || ':' || privilege_type, ', '), 'none') AS leaked_privileges
FROM information_schema.role_table_grants
WHERE grantee = 'anon' AND table_schema = 'public';

-- ----------------------------------------------------------------------------
-- 8. Table 'app_settings' is unreadable by role 'authenticated'
-- Expected: authenticated_cannot_read_app_settings = true.
-- ----------------------------------------------------------------------------
SELECT
  NOT has_table_privilege('authenticated', 'public.app_settings', 'SELECT') AS authenticated_cannot_read_app_settings;

-- ----------------------------------------------------------------------------
-- 9. Columns 'is_demo' and 'likes_you' on 'profiles' cannot be selected by 'authenticated'
-- Expected: is_demo_hidden_from_authenticated = true, likes_you_hidden_from_authenticated = true.
-- ----------------------------------------------------------------------------
SELECT
  NOT has_column_privilege('authenticated', 'public.profiles', 'is_demo', 'SELECT') AS is_demo_hidden_from_authenticated,
  NOT has_column_privilege('authenticated', 'public.profiles', 'likes_you', 'SELECT') AS likes_you_hidden_from_authenticated;
