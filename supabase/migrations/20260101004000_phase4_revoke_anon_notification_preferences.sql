-- Phase 4 security hardening (defence in depth). `notification_preferences` was left with Supabase's default
-- grants to `anon` (SELECT/INSERT/UPDATE/DELETE/TRUNCATE...). RLS already denied every anon row (all policies are
-- TO authenticated), so nothing was readable, but a table grant is one policy mistake away from exposure and
-- anonymous clients have no use for this table. Only signed-in users (and service_role) keep access.
-- Safe to re-apply.
BEGIN;
REVOKE ALL ON public.notification_preferences FROM anon;
REVOKE ALL ON public.notification_preferences FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
COMMIT;
