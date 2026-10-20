-- 20260101004500_setting_int_missing_key_default.sql
-- Hardening: public.setting_int(key, default, min, max) returned NULL, not the caller's default, when the key
-- had no row in public.app_settings, because the default was only applied inside a subquery that yields no
-- rows for a missing key. Callers such as record_like() compare against the result (`_likes >= _like_limit`),
-- and a comparison with NULL never fires, so deleting the 'daily_like_limit' row would silently remove the cap.
-- Every key the app uses is seeded today, so nothing is broken now; this removes the latent fail-open.
-- Only the function body changes. Signature, return type, volatility, SECURITY INVOKER, pinned search_path and
-- grants are identical (CREATE OR REPLACE keeps the existing grants). A missing key and a non-numeric value both
-- return the default; a numeric value is still clamped to [min, max]; the default itself is returned unclamped,
-- exactly as before. app_settings stays closed to anon by RLS. Earlier migrations are not edited.
BEGIN;

CREATE OR REPLACE FUNCTION public.setting_int(
  _key text,
  _default integer,
  _min integer DEFAULT NULL,
  _max integer DEFAULT NULL
) RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN _val IS NULL THEN _default
    WHEN _min IS NOT NULL AND _val < _min THEN _min
    WHEN _max IS NOT NULL AND _val > _max THEN _max
    ELSE _val
  END
  FROM (
    SELECT (
      SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::integer END
      FROM public.app_settings
      WHERE key = _key
    ) AS _val
  ) sub;
$function$;

COMMIT;
