-- ============================================================================
-- supabase/verification/post_deploy_checks.sql
-- SELECT-only assertions to verify remote schema and security hardening
-- immediately after running `supabase db push`.
-- All queries should return TRUE / PASS status.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. All expected application tables exist with Row Level Security enabled
-- Expected: Every row returns true (all 14 application tables).
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
    ('account_state'),
    ('swipes'),
    ('matches'),
    ('messages'),
    ('blocks'),
    ('reports'),
    ('user_daily_quotas'),
    ('user_subscriptions'),
    ('subscription_orders'),
    ('photo_reviews'),
    ('app_settings'),
    ('admin_audit')
) AS t(expected_table);

-- ----------------------------------------------------------------------------
-- 2. Storage buckets are configured and private
-- Expected: Both 'photos' and 'chat' return exists_and_is_private = true.
-- (Fails with false if either bucket is missing or public)
-- ----------------------------------------------------------------------------
SELECT
  b.expected_bucket AS bucket_name,
  EXISTS(
    SELECT 1 FROM storage.buckets
    WHERE id = b.expected_bucket AND public = false
  ) AS exists_and_is_private
FROM (
  VALUES ('photos'), ('chat')
) AS b(expected_bucket)
ORDER BY b.expected_bucket;

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
-- 4. purge_user_data RPC exists and is executable ONLY by service_role
-- Expected: function_exists = true, is_secure_service_role_only = true.
-- (Fails with false if function is missing or granted to anon/authenticated)
-- ----------------------------------------------------------------------------
SELECT
  'purge_user_data(uuid)' AS function_signature,
  (to_regprocedure('public.purge_user_data(uuid)') IS NOT NULL) AS function_exists,
  CASE
    WHEN to_regprocedure('public.purge_user_data(uuid)') IS NULL THEN false
    ELSE (
      NOT has_function_privilege('anon', 'public.purge_user_data(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.purge_user_data(uuid)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.purge_user_data(uuid)', 'EXECUTE')
    )
  END AS is_secure_service_role_only;

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

-- ----------------------------------------------------------------------------
-- 10. Security triggers exist AND are enabled:
--     - on_block_cleanup on public.blocks
--     - account_state_guard on public.account_state
-- Expected: Both rows return exists_and_is_enabled = true.
-- (tgenabled 'O' = origin/enabled, 'A' = always enabled)
-- ----------------------------------------------------------------------------
SELECT
  t_req.table_name,
  t_req.trigger_name,
  EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = t_req.table_name
      AND t.tgname = t_req.trigger_name
      AND t.tgenabled IN ('O', 'A')
  ) AS exists_and_is_enabled
FROM (
  VALUES
    ('blocks', 'on_block_cleanup'),
    ('account_state', 'account_state_guard')
) AS t_req(table_name, trigger_name);

-- ----------------------------------------------------------------------------
-- 11. Static definition guard: security functions reference block isolation check
-- Note: This static query verifies that the deployed definitions contain the
-- subroutine call. Comprehensive behavioral enforcement (role-switching,
-- blocked access denial, RLS) is verified via supabase/tests/28_security_foundations.sql.
-- Expected: Both return true.
-- ----------------------------------------------------------------------------
SELECT
  EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_match_member'
      AND pg_get_functiondef(p.oid) LIKE '%is_blocked_pair%'
  ) AS is_match_member_references_block_check,
  EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'chat_folder_member'
      AND pg_get_functiondef(p.oid) LIKE '%is_blocked_pair%'
  ) AS chat_folder_member_references_block_check;
