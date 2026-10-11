-- 20260101000600_trigger_function_hardening.sql
-- Consistency follow-up to 20260101000500 (no behaviour change; no data touched).
-- 1. The two rate-limit trigger functions were created after 0300's blanket REVOKE, so they kept the
--    default EXECUTE grant. They only ever run as triggers; no role needs to call them directly.
--    Triggers fire regardless of the caller's EXECUTE privilege (same as handle_new_user etc.).
-- 2. messages_guard still used the shorter `search_path = public`; align it with the other functions.
-- rls_auto_enable is Supabase-managed and intentionally left untouched.

REVOKE EXECUTE ON FUNCTION public.check_message_rate_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_report_rate_limit() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.messages_guard() SET search_path = public, pg_temp;
