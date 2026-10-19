\set ON_ERROR_STOP on
-- Phase 4 regression: anonymous clients hold no table privileges beyond the intentionally public ones.
INSERT INTO public.t_results SELECT 'p4: anon has no privilege on notification_preferences',
  NOT (has_table_privilege('anon', 'public.notification_preferences', 'SELECT')
    OR has_table_privilege('anon', 'public.notification_preferences', 'INSERT')
    OR has_table_privilege('anon', 'public.notification_preferences', 'UPDATE')
    OR has_table_privilege('anon', 'public.notification_preferences', 'DELETE')), 'revoked';
INSERT INTO public.t_results SELECT 'p4: signed-in users keep select/insert/update on their preferences',
  has_table_privilege('authenticated', 'public.notification_preferences', 'SELECT')
  AND has_table_privilege('authenticated', 'public.notification_preferences', 'INSERT')
  AND has_table_privilege('authenticated', 'public.notification_preferences', 'UPDATE'), 'kept';
SET ROLE anon;
CALL public.expect_fail('p4: anon cannot read notification_preferences', $q$SELECT count(*) FROM public.notification_preferences$q$);
RESET ROLE;
-- Allow-list: the only application tables (RLS-enabled; test scratch tables are not) anon may touch at all.
INSERT INTO public.t_results SELECT 'p4: anon table grants on application tables are limited to the legal-document list',
  coalesce(bool_and(g.table_name = 'legal_document_versions' AND g.privilege_type = 'SELECT'), true),
  coalesce(string_agg(g.table_name || ':' || g.privilege_type, ','), 'none')
  FROM information_schema.role_table_grants g
  JOIN pg_class c ON c.oid = ('public.' || quote_ident(g.table_name))::regclass AND c.relrowsecurity
  WHERE g.table_schema = 'public' AND g.grantee = 'anon';
