\set ON_ERROR_STOP on
-- 64_setting_int_default.sql: public.setting_int() returns the caller's default for a missing key
-- (migration 20260101004500); before it returned NULL, which made `count >= limit` checks fail open.
-- Uses its own throwaway keys; real settings are not touched.
INSERT INTO public.app_settings (key, value) VALUES
  ('test64_value', '40'::jsonb), ('test64_text', '"abc"'::jsonb);

INSERT INTO public.t_results SELECT 'p64 setting_int: a missing key returns the default, not NULL',
  public.setting_int('test64_missing', 7) = 7, coalesce(public.setting_int('test64_missing', 7)::text, 'NULL');
INSERT INTO public.t_results SELECT 'p64 setting_int: a missing key still returns the default when bounds are given',
  public.setting_int('test64_missing', 7, 1, 10) = 7, 'bounds';
INSERT INTO public.t_results SELECT 'p64 setting_int: a stored number is returned',
  public.setting_int('test64_value', 7) = 40, 'stored';
INSERT INTO public.t_results SELECT 'p64 setting_int: a stored number is clamped to max and to min',
  public.setting_int('test64_value', 7, 1, 25) = 25 AND public.setting_int('test64_value', 7, 50, 100) = 50, 'clamp';
INSERT INTO public.t_results SELECT 'p64 setting_int: a non-numeric value returns the default',
  public.setting_int('test64_text', 7) = 7, 'text';
-- Other suites change daily_like_limit in this shared database, so compare with the stored row, not a literal.
INSERT INTO public.t_results SELECT 'p64 setting_int: an existing real setting still returns its stored value',
  public.setting_int('daily_like_limit', -1) = (value #>> '{}')::integer, public.setting_int('daily_like_limit', -1)::text
  FROM public.app_settings WHERE key = 'daily_like_limit';

DELETE FROM public.app_settings WHERE key IN ('test64_value', 'test64_text');

INSERT INTO public.t_results SELECT 'p64 setting_int: one overload, SECURITY INVOKER, pinned search_path',
  count(*) = 1 AND NOT bool_or(prosecdef) AND bool_and(proconfig::text LIKE '%search_path%'), count(*)::text
  FROM pg_proc WHERE proname = 'setting_int' AND pronamespace = 'public'::regnamespace;
INSERT INTO public.t_results SELECT 'p64 setting_int: anon still cannot read app_settings directly',
  NOT has_table_privilege('anon', 'public.app_settings', 'SELECT'), 'closed';
