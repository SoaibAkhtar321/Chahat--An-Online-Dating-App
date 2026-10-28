\set ON_ERROR_STOP on
-- 71_dynamic_city_search.sql (20260101005700): gazetteer search, dynamic manual cities, server-side resolution of
-- the current-location city, and the city-to-city-only rule for manual (city-anchored) viewers.
-- Users: s1 (consent), s2 (consent), viewer M (manual city, no coordinates), target T (device fix, shares distance).
INSERT INTO auth.users(id, email) VALUES
  ('71000000-0000-0000-0000-000000000001', 'dyn1@x'),
  ('71000000-0000-0000-0000-000000000002', 'dyn2@x'),
  ('71000000-0000-0000-0000-000000000011', 'dynm@x'),
  ('71000000-0000-0000-0000-000000000012', 'dynt@x');
CALL public.test_complete_profile('71000000-0000-0000-0000-000000000001', 'Dyn One', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('71000000-0000-0000-0000-000000000002', 'Dyn Two', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('71000000-0000-0000-0000-000000000011', 'Dyn Viewer', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('71000000-0000-0000-0000-000000000012', 'Dyn Target', '1996-01-01', 'woman', 'man');
INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
SELECT id, 'location_discovery', '2026-10-18', 'granted', 'in_app_notice'
FROM auth.users WHERE id::text LIKE '71000000%';

-- 1. Gazetteer contents and access ---------------------------------------------------------------------------------
INSERT INTO public.t_results SELECT 'dyn: gazetteer seeded beyond the 44 curated cities',
  count(*) > 4000 AND count(*) FILTER (WHERE source = 'curated') = 44, count(*)::text FROM public.city_centroids;
INSERT INTO public.t_results SELECT 'dyn: curated city coordinates are unchanged (Pune)',
  latitude = 18.52 AND longitude = 73.86, latitude::text || ',' || longitude::text
FROM public.city_centroids WHERE name_key = 'pune';
INSERT INTO public.t_results SELECT 'dyn: no gazetteer row duplicates a curated city within 30 km',
  count(*) = 0, count(*)::text
FROM public.city_centroids g JOIN public.city_centroids c
  ON c.source = 'curated' AND g.source = 'gazetteer'
 AND split_part(g.name_key, ',', 1) = c.name_key
 AND public.haversine_km(g.latitude, g.longitude, c.latitude, c.longitude) <= 30;

SET ROLE anon;
CALL public.expect_fail('dyn: anon cannot search cities', $q$SELECT * FROM public.search_cities('gor')$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
CALL public.expect_fail('dyn: clients still cannot read the city table', $q$SELECT * FROM public.city_centroids$q$);
CALL public.expect_fail('dyn: clients cannot read the alias table', $q$SELECT * FROM public.city_aliases$q$);
CALL public.expect_fail('dyn: clients cannot call nearest_city_centroid',
  $q$SELECT public.nearest_city_centroid(26.76, 83.37, 150)$q$);
CALL public.expect_fail('dyn: oversized search limit rejected', $q$SELECT * FROM public.search_cities('gor', 500)$q$);
CALL public.expect_fail('dyn: oversized query rejected', $q$SELECT * FROM public.search_cities(repeat('a', 81))$q$);

-- 2. Search ----------------------------------------------------------------------------------------------------------
INSERT INTO public.t_results SELECT 'dyn: search finds Greater Noida (Uttar Pradesh)',
  bool_or(name = 'Greater Noida' AND state = 'Uttar Pradesh'), string_agg(name, '|')
FROM public.search_cities('greater no');
INSERT INTO public.t_results SELECT 'dyn: search lists both Gorakhpurs, state-qualified',
  bool_or(name = 'Gorakhpur, Uttar Pradesh') AND bool_or(name = 'Gorakhpur, Haryana'), string_agg(name, '|')
FROM public.search_cities('Gorakhpur');
INSERT INTO public.t_results SELECT 'dyn: search finds Kolkata first', (array_agg(name))[1] = 'Kolkata', string_agg(name, '|')
FROM public.search_cities('kolk');
INSERT INTO public.t_results SELECT 'dyn: search finds Kushinagar', bool_or(name = 'Kushinagar'), string_agg(name, '|')
FROM public.search_cities('Kushi');
INSERT INTO public.t_results SELECT 'dyn: old names find the city (calcutta -> Kolkata)',
  bool_or(name = 'Kolkata'), string_agg(name, '|') FROM public.search_cities('calcutta');
INSERT INTO public.t_results SELECT 'dyn: one-character and empty queries return nothing',
  (SELECT count(*) FROM public.search_cities('k')) = 0 AND (SELECT count(*) FROM public.search_cities('  ')) = 0
    AND (SELECT count(*) FROM public.search_cities(NULL)) = 0, '';
INSERT INTO public.t_results SELECT 'dyn: LIKE wildcards are literal', count(*) = 0, count(*)::text
FROM public.search_cities('%%');
INSERT INTO public.t_results SELECT 'dyn: limit is honoured', count(*) <= 3, count(*)::text
FROM public.search_cities('ra', 3);
INSERT INTO public.t_results SELECT 'dyn: search returns only name and state (no coordinates)',
  (SELECT proargnames FROM pg_proc WHERE proname = 'search_cities') = ARRAY['_query', '_limit', 'name', 'state'],
  (SELECT proargnames::text FROM pg_proc WHERE proname = 'search_cities');

-- 3. Manual selection of any listed place --------------------------------------------------------------------------
SELECT public.set_my_location_selection('manual', 'kushinagar');
SELECT public.set_my_location_selection('manual', 'Gorakhpur, Uttar Pradesh');
CALL public.expect_fail('dyn: ambiguous bare name is not guessed (unknown_city)',
  $q$SELECT public.set_my_location_selection('manual', 'Gorakhpur')$q$);
CALL public.expect_fail('dyn: manual mode still requires a city', $q$SELECT public.set_my_location_selection('manual', NULL)$q$);
RESET ROLE;
INSERT INTO public.t_results SELECT 'dyn: manual selection stores the gazetteer display name, no coordinates',
  p.city = 'Gorakhpur, Uttar Pradesh'
    AND NOT EXISTS (SELECT 1 FROM public.discovery_locations l WHERE l.user_id = p.user_id),
  p.city
FROM public.profiles p WHERE p.id = '71000000-0000-0000-0000-000000000001';
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'dyn: read model returns city and state, never coordinates',
  r->>'city' = 'Gorakhpur, Uttar Pradesh' AND r->>'state' = 'Uttar Pradesh' AND r->>'mode' = 'manual'
    AND NOT (r ? 'latitude') AND NOT (r ? 'longitude'),
  r::text
FROM (SELECT public.get_my_location_selection() AS r) x;

-- 4. Current location: the server resolves the place -----------------------------------------------------------------
INSERT INTO public.t_json SELECT 'dyn_gps',
  public.set_my_location_selection('current', NULL, 26.7605, 83.3731, 30);
RESET ROLE;
INSERT INTO public.t_results SELECT 'dyn: current mode with no city resolves the nearest place (Gorakhpur, UP)',
  result->>'city' = 'Gorakhpur, Uttar Pradesh' AND result->>'mode' = 'current', result::text
FROM public.t_json WHERE label = 'dyn_gps';
INSERT INTO public.t_results SELECT 'dyn: current mode stores snapped (~1 km) coordinates only',
  latitude = 26.76 AND longitude = 83.37, latitude::text || ',' || longitude::text
FROM public.discovery_locations WHERE user_id = '71000000-0000-0000-0000-000000000001';

SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-000000000002';
CALL public.expect_fail('dyn: a known city far from the device is still refused (city_mismatch)',
  $q$SELECT public.set_my_location_selection('current', 'Mumbai', 26.76, 83.37, 30)$q$);
CALL public.expect_fail('dyn: no Indian place within 150 km is refused (no_city_nearby)',
  $q$SELECT public.set_my_location_selection('current', NULL, 0.5, 0.5, 30)$q$);
CALL public.expect_fail('dyn: current mode still needs coordinates',
  $q$SELECT public.set_my_location_selection('current', NULL)$q$);
INSERT INTO public.t_json SELECT 'dyn_unknown_name',
  public.set_my_location_selection('current', 'Some Unknown Suburb', 28.4744, 77.5040, 20);
RESET ROLE;
INSERT INTO public.t_results SELECT 'dyn: an unknown geocoder name falls back to the nearest place (Greater Noida area)',
  result->>'mode' = 'current' AND result->>'city' IS NOT NULL
    AND (SELECT public.haversine_km(28.47, 77.50, c.latitude, c.longitude) FROM public.city_centroids c
         WHERE c.display_name = result->>'city') <= 15,
  result::text
FROM public.t_json WHERE label = 'dyn_unknown_name';
INSERT INTO public.t_results SELECT 'dyn: failed requests did not touch s2 coordinates beyond the one success',
  count(*) = 1, count(*)::text FROM public.discovery_locations WHERE user_id = '71000000-0000-0000-0000-000000000002';

-- 5. A manual viewer never gets distances computed from another member's device position -----------------------------
-- M picks Greater Noida manually; T has a device fix 6 km from Greater Noida's centre but her profile city is Noida.
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-000000000011';
SELECT public.set_my_location_selection('manual', 'Greater Noida');
RESET ROLE;
UPDATE public.profiles SET city = 'Noida' WHERE id = '71000000-0000-0000-0000-000000000012';
INSERT INTO public.discovery_locations (user_id, latitude, longitude)
VALUES ('71000000-0000-0000-0000-000000000012', 28.45, 77.49);
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-000000000011';
RESET ROLE;
-- Compute the expected value as the owner (haversine_km is not granted to clients), then compare.
CREATE TEMP TABLE t_dyn_expect AS
SELECT public.distance_bucket_km(public.haversine_km(g.latitude, g.longitude, n.latitude, n.longitude)) AS city_km,
       public.distance_bucket_km(public.haversine_km(28.50, 77.54, 28.45, 77.49)) AS device_km,
       public.distance_bucket_km(public.haversine_km(g.latitude, g.longitude, 28.45, 77.49)) AS manual_device_km
FROM public.city_centroids g, public.city_centroids n WHERE g.name_key = 'greater noida' AND n.name_key = 'noida';
GRANT SELECT ON t_dyn_expect TO PUBLIC;
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-000000000011';
INSERT INTO public.t_results SELECT 'dyn privacy: manual viewer gets the city-centre distance, not the device distance',
  f.distance_basis = 'city' AND f.distance_km = e.city_km AND e.city_km <> e.manual_device_km,
  coalesce(f.distance_km::text, 'null') || ' city=' || e.city_km || ' device=' || e.device_km
FROM public.get_discovery_feed_page(50, 18, 99, 150) f, t_dyn_expect e
WHERE f.id = '71000000-0000-0000-0000-000000000012';
INSERT INTO public.t_results SELECT 'dyn privacy: feed rows never carry coordinates',
  NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = 'get_discovery_feed_page'
              AND (p.proargnames::text ILIKE '%latitude%' OR p.proargnames::text ILIKE '%longitude%')), '';
INSERT INTO public.t_results SELECT 'dyn privacy: get_distance_to stays null for a viewer without a device fix',
  public.get_distance_to('71000000-0000-0000-0000-000000000012') IS NULL, '';
RESET ROLE;

-- 6. Device viewer still gets device-based distance (behaviour unchanged) --------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub = '71000000-0000-0000-0000-000000000011';
SELECT public.set_my_location_selection('current', NULL, 28.4962, 77.5360, 20);
INSERT INTO public.t_results SELECT 'dyn: device viewer gets device-to-device distance with device basis',
  f.distance_basis = 'device' AND f.distance_km = e.device_km,
  coalesce(f.distance_km::text, 'null') || ' device=' || e.device_km
FROM public.get_discovery_feed_page(50, 18, 99, 150) f, t_dyn_expect e
WHERE f.id = '71000000-0000-0000-0000-000000000012';
RESET ROLE;
