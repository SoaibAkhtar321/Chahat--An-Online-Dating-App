\set ON_ERROR_STOP on
-- 62_discovery_city_anchor.sql (Phase 5): distance-ranked discovery with a city-centre anchor when there are no
-- device coordinates, nearest-first expansion up to the maximum radius, pagination without duplicates, exclusions
-- preserved (gender, age, blocks, swipes, status), and no coordinate exposure.
-- Viewers: V (Pune, no coordinates), W (Thane, no profiles of its own), U (no city, no coordinates).
-- Candidates (all women seeking men unless noted): A Pune, B Mumbai, C Delhi, D Pune (device fix, hides distance),
-- E unsupported town, F Nashik, G blocked, H already swiped, I man, J aged 66, K suspended.
INSERT INTO auth.users(id, email)
SELECT ('62000000-0000-0000-0000-0000000000' || n)::uuid, 'anchor' || n || '@x'
FROM unnest(ARRAY['01','02','03','11','12','13','14','15','16','17','18','19','1a','1b']) AS n;

CALL public.test_complete_profile('62000000-0000-0000-0000-000000000001', 'Viewer V', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('62000000-0000-0000-0000-000000000002', 'Viewer W', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('62000000-0000-0000-0000-000000000003', 'Viewer U', '1995-01-01', 'man', 'woman');
DO $$
DECLARE n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['11','12','13','14','15','16','17','18','1a','1b'] LOOP
    CALL public.test_complete_profile(('62000000-0000-0000-0000-0000000000' || n)::uuid, 'Cand ' || n,
      '1996-01-01', 'woman', 'man');
  END LOOP;
END $$;
CALL public.test_complete_profile('62000000-0000-0000-0000-000000000019', 'Cand man', '1996-01-01', 'man', 'woman');

UPDATE public.profiles SET city = 'Thane' WHERE id = '62000000-0000-0000-0000-000000000002';
UPDATE public.profiles SET city = ''      WHERE id = '62000000-0000-0000-0000-000000000003';
UPDATE public.profiles SET city = 'Mumbai'    WHERE id = '62000000-0000-0000-0000-000000000012';
UPDATE public.profiles SET city = 'Delhi'     WHERE id = '62000000-0000-0000-0000-000000000013';
UPDATE public.profiles SET city = 'Smalltown' WHERE id = '62000000-0000-0000-0000-000000000015';
UPDATE public.profiles SET city = 'nashik'    WHERE id = '62000000-0000-0000-0000-000000000016';
UPDATE public.profiles SET dob = '1960-01-01' WHERE id = '62000000-0000-0000-0000-00000000001a';
UPDATE public.profiles SET status = 'suspended' WHERE id = '62000000-0000-0000-0000-00000000001b';

INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
SELECT id, 'location_discovery', '2026-10-18', 'granted', 'in_app_notice'
FROM auth.users WHERE id::text LIKE '62000000%';
-- D has a fresh device fix and hides its distance
INSERT INTO public.discovery_locations (user_id, latitude, longitude)
VALUES ('62000000-0000-0000-0000-000000000014', 18.55, 73.90);
UPDATE public.discovery_location_settings SET share_distance = false
WHERE user_id = '62000000-0000-0000-0000-000000000014';
-- G is blocked by V, H was already swiped by V
INSERT INTO public.blocks (blocker, blocked)
VALUES ('62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000017');
INSERT INTO public.swipes (from_id, to_id, kind)
VALUES ('62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000018', 'pass');

-- 1. City-anchored viewer (no device coordinates) --------------------------------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub = '62000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'p5 feed: city anchor at 150 km returns Pune, Pune-with-fix and Mumbai only',
  coalesce(array_agg(id ORDER BY id), '{}') = ARRAY[
    '62000000-0000-0000-0000-000000000011', '62000000-0000-0000-0000-000000000012', '62000000-0000-0000-0000-000000000014'],
  coalesce(string_agg(right(id, 2), ',' ORDER BY id), 'none')
  FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL);
INSERT INTO public.t_results SELECT 'p5 feed: nearest first (Pune, then Pune-with-fix, then Mumbai)',
  coalesce(array_agg(id ORDER BY cursor_distance_m, id), '{}') = ARRAY[
    '62000000-0000-0000-0000-000000000011', '62000000-0000-0000-0000-000000000014', '62000000-0000-0000-0000-000000000012'],
  coalesce(string_agg(right(id, 2), ',' ORDER BY cursor_distance_m, id), 'none')
  FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL);
INSERT INTO public.t_results SELECT 'p5 feed: a farther city is excluded by a smaller maximum radius (100 km drops Mumbai)',
  coalesce(array_agg(id ORDER BY id), '{}') = ARRAY[
    '62000000-0000-0000-0000-000000000011', '62000000-0000-0000-0000-000000000014'],
  coalesce(string_agg(right(id, 2), ',' ORDER BY id), 'none')
  FROM public.get_discovery_feed_page(50, 18, 50, 100, '{}', '{}', '{}', NULL, NULL);
INSERT INTO public.t_results SELECT 'p5 feed: widening to 200 km expands to Nashik, still not Delhi',
  coalesce(array_agg(id ORDER BY cursor_distance_m, id), '{}') = ARRAY[
    '62000000-0000-0000-0000-000000000011', '62000000-0000-0000-0000-000000000014',
    '62000000-0000-0000-0000-000000000012', '62000000-0000-0000-0000-000000000016'],
  coalesce(string_agg(right(id, 2), ',' ORDER BY cursor_distance_m, id), 'none')
  FROM public.get_discovery_feed_page(50, 18, 50, 200, '{}', '{}', '{}', NULL, NULL);
INSERT INTO public.t_results SELECT 'p5 feed: distant cities appear within the configured maximum (Delhi at 1500 is out of range at 500)',
  NOT EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 50, 500, '{}', '{}', '{}', NULL, NULL)
              WHERE id = '62000000-0000-0000-0000-000000000013'), 'delhi';

-- 2. Distance labels: city-level, bucketed, never exact; hidden distance respected ----------------------------------
INSERT INTO public.t_results SELECT 'p5 feed: city-anchored distances are flagged city, never device',
  count(*) = 3 AND bool_and(distance_basis = 'city'), string_agg(distance_basis, ',')
  FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL);
INSERT INTO public.t_results SELECT 'p5 feed: Mumbai is city-to-city bucketed (115-130 km, multiple of 5)',
  count(*) = 1 AND bool_and(distance_km BETWEEN 115 AND 130 AND distance_km % 5 = 0), coalesce(max(distance_km)::text, 'none')
  FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL)
  WHERE id = '62000000-0000-0000-0000-000000000012';
INSERT INTO public.t_results SELECT 'p5 feed: a member who hides distance shows none but is still returned',
  count(*) = 1 AND bool_and(distance_km IS NULL), count(*)::text
  FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL)
  WHERE id = '62000000-0000-0000-0000-000000000014';
INSERT INTO public.t_results SELECT 'p5 feed: cursor exposes only the bucket, never exact metres',
  bool_and(cursor_distance_m % 1000 = 0), string_agg(cursor_distance_m::text, ',')
  FROM public.get_discovery_feed_page(50, 18, 50, 200, '{}', '{}', '{}', NULL, NULL);

-- 3. Existing product rules are preserved --------------------------------------------------------------------------
INSERT INTO public.t_results SELECT 'p5 feed: blocked, swiped, wrong-gender, suspended and unsupported-city members are excluded',
  NOT EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 99, 500, '{}', '{}', '{}', NULL, NULL)
              WHERE id IN ('62000000-0000-0000-0000-000000000017', '62000000-0000-0000-0000-000000000018',
                           '62000000-0000-0000-0000-000000000019', '62000000-0000-0000-0000-00000000001b',
                           '62000000-0000-0000-0000-000000000015')), 'excluded';
INSERT INTO public.t_results SELECT 'p5 feed: the age filter still applies',
  NOT EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL)
              WHERE id = '62000000-0000-0000-0000-00000000001a')
  AND EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 99, 150, '{}', '{}', '{}', NULL, NULL)
              WHERE id = '62000000-0000-0000-0000-00000000001a'), 'age';
INSERT INTO public.t_results SELECT 'p5 feed: the viewer is never in their own feed',
  NOT EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 99, 500, '{}', '{}', '{}', NULL, NULL)
              WHERE id = '62000000-0000-0000-0000-000000000001'), 'self';

-- 4. Pagination: one profile per page, no duplicates, nothing skipped ---------------------------------------------
CREATE TEMP TABLE p5_pages (page integer, id text);
GRANT ALL ON p5_pages TO PUBLIC;
DO $$
DECLARE
  _cur_d integer := NULL;
  _cur_id text := NULL;
  _row record;
  _page integer := 0;
  _found boolean;
BEGIN
  LOOP
    _found := false;
    FOR _row IN
      SELECT f.id, f.cursor_distance_m FROM public.get_discovery_feed_page(1, 18, 50, 200, '{}', '{}', '{}', _cur_d, _cur_id) f
    LOOP
      _found := true;
      _page := _page + 1;
      INSERT INTO p5_pages VALUES (_page, _row.id);
      _cur_d := _row.cursor_distance_m;
      _cur_id := _row.id;
    END LOOP;
    EXIT WHEN NOT _found OR _page > 20;
  END LOOP;
END $$;
INSERT INTO public.t_results SELECT 'p5 feed: paging one at a time yields every eligible profile exactly once, nearest first',
  (SELECT array_agg(id ORDER BY page) FROM p5_pages) = ARRAY[
    '62000000-0000-0000-0000-000000000011', '62000000-0000-0000-0000-000000000014',
    '62000000-0000-0000-0000-000000000012', '62000000-0000-0000-0000-000000000016']
  AND (SELECT count(DISTINCT id) FROM p5_pages) = (SELECT count(*) FROM p5_pages),
  coalesce((SELECT string_agg(right(id, 2), ',' ORDER BY page) FROM p5_pages), 'none');
RESET ROLE;

-- 5. Never empty because the selected city has no profiles ------------------------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub = '62000000-0000-0000-0000-000000000002';
INSERT INTO public.t_results SELECT 'p5 feed: a viewer whose own city has no members still sees nearby cities (Thane sees Mumbai first)',
  count(*) >= 2 AND (array_agg(id ORDER BY cursor_distance_m, id))[1] = '62000000-0000-0000-0000-000000000012',
  coalesce(string_agg(right(id, 2), ',' ORDER BY cursor_distance_m, id), 'none')
  FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL);
RESET ROLE;

-- 6. Device-anchored viewer: precise-to-precise is 'device', everything else stays 'city' ------------------------------
INSERT INTO public.discovery_locations (user_id, latitude, longitude)
VALUES ('62000000-0000-0000-0000-000000000001', 18.52, 73.86);
SET ROLE authenticated; SET request.jwt.claim.sub = '62000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'p5 feed: device-to-device is device, device-to-city-centre is city',
  (SELECT distance_basis FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL)
    WHERE id = '62000000-0000-0000-0000-000000000014') = 'device'
  AND (SELECT distance_basis FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL)
    WHERE id = '62000000-0000-0000-0000-000000000011') = 'city', 'device vs city';
RESET ROLE;
DELETE FROM public.discovery_locations WHERE user_id = '62000000-0000-0000-0000-000000000001';

-- 7. No anchor at all (no coordinates, no supported city): documented fallback, no distance filter -------------------
SET ROLE authenticated; SET request.jwt.claim.sub = '62000000-0000-0000-0000-000000000003';
INSERT INTO public.t_results SELECT 'p5 feed: with no anchor members are listed without any distance (never a made-up distance)',
  count(*) >= 5 AND bool_and(distance_km IS NULL AND distance_basis IS NULL)
  AND EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL)
              WHERE id = '62000000-0000-0000-0000-000000000013'),
  count(*)::text
  FROM public.get_discovery_feed_page(50, 18, 50, 150, '{}', '{}', '{}', NULL, NULL);
RESET ROLE;

-- 8. Validation, authorization and the configurable ceiling --------------------------------------------------------------
SET ROLE anon;
CALL public.expect_fail('p5 feed: anon cannot call the feed',
  $q$SELECT * FROM public.get_discovery_feed_page(10, 18, 50, 100, '{}', '{}', '{}', NULL, NULL)$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '62000000-0000-0000-0000-000000000001';
CALL public.expect_fail('p5 feed: radius above the server ceiling (500) is rejected',
  $q$SELECT * FROM public.get_discovery_feed_page(10, 18, 50, 501, '{}', '{}', '{}', NULL, NULL)$q$);
CALL public.expect_fail('p5 feed: radius 0 rejected',
  $q$SELECT * FROM public.get_discovery_feed_page(10, 18, 50, 0, '{}', '{}', '{}', NULL, NULL)$q$);
CALL public.expect_fail('p5 feed: half-supplied cursor rejected',
  $q$SELECT * FROM public.get_discovery_feed_page(10, 18, 50, 100, '{}', '{}', '{}', 5000, NULL)$q$);
RESET ROLE;
INSERT INTO public.app_settings (key, value) VALUES ('discovery_max_radius_km', '200'::jsonb);
SET ROLE authenticated; SET request.jwt.claim.sub = '62000000-0000-0000-0000-000000000001';
CALL public.expect_fail('p5 feed: the ceiling is configurable (200 km via app_settings)',
  $q$SELECT * FROM public.get_discovery_feed_page(10, 18, 50, 300, '{}', '{}', '{}', NULL, NULL)$q$);
INSERT INTO public.t_results SELECT 'p5 feed: a radius within the configured ceiling still works',
  count(*) >= 1, count(*)::text FROM public.get_discovery_feed_page(10, 18, 50, 200, '{}', '{}', '{}', NULL, NULL);
RESET ROLE;
DELETE FROM public.app_settings WHERE key = 'discovery_max_radius_km';

-- 9. Structure: no coordinate columns in the result, and the lookup index exists ---------------------------------------
INSERT INTO public.t_results SELECT 'p5 feed: the result type has no latitude/longitude columns',
  NOT ('latitude' = ANY (proargnames) OR 'longitude' = ANY (proargnames) OR 'pos_lat' = ANY (proargnames)),
  array_to_string(proargnames, ',')
  FROM pg_proc WHERE proname = 'get_discovery_feed_page' AND pronamespace = 'public'::regnamespace;
INSERT INTO public.t_results SELECT 'p5 feed: only one overload of the feed exists',
  count(*) = 1, count(*)::text FROM pg_proc WHERE proname = 'get_discovery_feed_page' AND pronamespace = 'public'::regnamespace;
INSERT INTO public.t_results SELECT 'p5 feed: the city lookup index exists',
  count(*) = 1, count(*)::text FROM pg_indexes WHERE indexname = 'profiles_city_key_idx';
