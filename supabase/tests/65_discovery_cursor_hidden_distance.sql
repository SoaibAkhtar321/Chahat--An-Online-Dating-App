\set ON_ERROR_STOP on
-- 65_discovery_cursor_hidden_distance.sql: migration 20260101004600. A member who hides their distance must not
-- leak their 5 km distance bucket through cursor_distance_m (the paging key). Their key is coarsened to 25 km
-- steps rounded up; members who share their distance keep the exact bucket key. Radius membership is unchanged.
-- Viewer V (man seeking woman, Pune, no device fix -> city anchor). Candidates (women, Pune) carry a unique
-- interest so the feed can be filtered to this test's members only:
--   11 shares distance, device fix ~11 km north of the Pune centre
--   12 hides distance, device fix at the same place
INSERT INTO auth.users(id, email)
SELECT ('65000000-0000-0000-0000-0000000000' || n)::uuid, 'cursor' || n || '@x'
FROM unnest(ARRAY['01','11','12']) AS n;

CALL public.test_complete_profile('65000000-0000-0000-0000-000000000001', 'Viewer V', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('65000000-0000-0000-0000-000000000011', 'Cand 11', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('65000000-0000-0000-0000-000000000012', 'Cand 12', '1996-01-01', 'woman', 'man');
UPDATE public.profiles SET interests = ARRAY['t65cursor']
WHERE id IN ('65000000-0000-0000-0000-000000000011', '65000000-0000-0000-0000-000000000012');

INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
SELECT id, 'location_discovery', '2026-10-18', 'granted', 'in_app_notice'
FROM auth.users WHERE id::text LIKE '65000000%';
INSERT INTO public.discovery_locations (user_id, latitude, longitude) VALUES
  ('65000000-0000-0000-0000-000000000011', 18.62, 73.86),
  ('65000000-0000-0000-0000-000000000012', 18.62, 73.86);
UPDATE public.discovery_location_settings SET share_distance = false
WHERE user_id = '65000000-0000-0000-0000-000000000012';

SET ROLE authenticated; SET request.jwt.claim.sub = '65000000-0000-0000-0000-000000000001';

CREATE TEMP TABLE t65 AS
SELECT * FROM public.get_discovery_feed_page(50, 18, 99, 150, '{}', '{t65cursor}', '{}', NULL, NULL);
GRANT SELECT ON t65 TO PUBLIC;

INSERT INTO public.t_results SELECT 'p6 cursor: both candidates are returned within the radius',
  count(*) = 2, count(*)::text FROM t65;
INSERT INTO public.t_results SELECT 'p6 cursor: a member who shares distance keeps the exact bucket as cursor',
  cursor_distance_m = distance_km * 1000 AND distance_km IS NOT NULL AND cursor_distance_m % 25000 <> 0,
  cursor_distance_m::text
  FROM t65 WHERE id = '65000000-0000-0000-0000-000000000011';
INSERT INTO public.t_results SELECT 'p6 cursor: a member who hides distance has no distance_km',
  distance_km IS NULL, coalesce(distance_km::text, 'null')
  FROM t65 WHERE id = '65000000-0000-0000-0000-000000000012';
INSERT INTO public.t_results SELECT 'p6 cursor: a hiding member cursor is a coarse 25 km step, not the 5 km bucket',
  h.cursor_distance_m % 25000 = 0 AND h.cursor_distance_m >= s.cursor_distance_m,
  h.cursor_distance_m::text || ' vs ' || s.cursor_distance_m::text
  FROM t65 h, t65 s
  WHERE h.id = '65000000-0000-0000-0000-000000000012' AND s.id = '65000000-0000-0000-0000-000000000011';
INSERT INTO public.t_results SELECT 'p6 cursor: the hiding member sorts after the sharing member at the same position',
  (SELECT array_agg(id ORDER BY ord) FROM (SELECT id, row_number() OVER () ord FROM
     public.get_discovery_feed_page(50, 18, 99, 150, '{}', '{t65cursor}', '{}', NULL, NULL)) q)
  = ARRAY['65000000-0000-0000-0000-000000000011', '65000000-0000-0000-0000-000000000012'], 'order';

-- Paging with the coarse cursor continues correctly: nothing repeats, nothing is skipped.
INSERT INTO public.t_results SELECT 'p6 cursor: paging one row at a time visits both members exactly once',
  (SELECT array_agg(id ORDER BY ord) FROM (
     SELECT id, 1 AS ord FROM public.get_discovery_feed_page(1, 18, 99, 150, '{}', '{t65cursor}', '{}', NULL, NULL)
     UNION ALL
     SELECT g.id, 2 FROM public.get_discovery_feed_page(1, 18, 99, 150, '{}', '{t65cursor}', '{}',
       (SELECT cursor_distance_m FROM t65 WHERE id = '65000000-0000-0000-0000-000000000011'),
       '65000000-0000-0000-0000-000000000011') g
  ) z) = ARRAY['65000000-0000-0000-0000-000000000011', '65000000-0000-0000-0000-000000000012'], 'two pages';
INSERT INTO public.t_results SELECT 'p6 cursor: the page after the last member is empty',
  NOT EXISTS (SELECT 1 FROM public.get_discovery_feed_page(10, 18, 99, 150, '{}', '{t65cursor}', '{}',
       (SELECT cursor_distance_m FROM t65 WHERE id = '65000000-0000-0000-0000-000000000012'),
       '65000000-0000-0000-0000-000000000012')), 'end';
-- Global feed: the radius is advisory only, so a 5 km radius still returns both (they are ~11 km away).
INSERT INTO public.t_results SELECT 'p6 cursor: a small radius no longer excludes anyone (global feed)',
  (SELECT count(*) FROM public.get_discovery_feed_page(50, 18, 99, 5, '{}', '{t65cursor}', '{}', NULL, NULL)) = 2, 'radius';
RESET ROLE;
DROP TABLE t65;

SET ROLE anon;
CALL public.expect_fail('p6 cursor: anon still cannot call the feed',
  $q$SELECT * FROM public.get_discovery_feed_page(10, 18, 50, 100, '{}', '{}', '{}', NULL, NULL)$q$);
RESET ROLE;

INSERT INTO public.t_results SELECT 'p6 cursor: one overload, SECURITY DEFINER, pinned search_path, grants unchanged',
  count(*) = 1 AND bool_and(prosecdef) AND bool_and(proconfig::text LIKE '%search_path%')
  AND bool_and(has_function_privilege('authenticated', oid, 'EXECUTE'))
  AND NOT bool_or(has_function_privilege('anon', oid, 'EXECUTE')), count(*)::text
  FROM pg_proc WHERE proname = 'get_discovery_feed_page' AND pronamespace = 'public'::regnamespace;
