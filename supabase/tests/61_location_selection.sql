\set ON_ERROR_STOP on
-- 61_location_selection.sql (Phase 5): the atomic set_my_location_selection / get_my_location_selection RPCs,
-- the city lookup, the mode triggers, authorization and input validation.
-- Users: u1 member with consent, u2 member WITHOUT location consent, u3 trigger probe.
INSERT INTO auth.users(id, email) VALUES
  ('61000000-0000-0000-0000-000000000001', 'sel1@x'),
  ('61000000-0000-0000-0000-000000000002', 'sel2@x'),
  ('61000000-0000-0000-0000-000000000003', 'sel3@x');
CALL public.test_complete_profile('61000000-0000-0000-0000-000000000001', 'Sel One', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('61000000-0000-0000-0000-000000000002', 'Sel Two', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('61000000-0000-0000-0000-000000000003', 'Sel Three', '1995-01-01', 'man', 'woman');
INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
SELECT id, 'location_discovery', '2026-10-18', 'granted', 'in_app_notice'
FROM auth.users WHERE id::text LIKE '61000000%' AND id::text <> '61000000-0000-0000-0000-000000000002';

-- 1. Authorization -------------------------------------------------------------------------------------------------
SET ROLE anon;
CALL public.expect_fail('p5: anon cannot set_my_location_selection',
  $q$SELECT public.set_my_location_selection('manual', 'Pune')$q$);
CALL public.expect_fail('p5: anon cannot get_my_location_selection', $q$SELECT public.get_my_location_selection()$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '61000000-0000-0000-0000-000000000001';
CALL public.expect_fail('p5: clients cannot read the city lookup table', $q$SELECT * FROM public.city_centroids$q$);
CALL public.expect_fail('p5: clients cannot write the city lookup table',
  $q$INSERT INTO public.city_centroids VALUES ('evil', 'Evil', 0, 0)$q$);
CALL public.expect_fail('p5: clients cannot call the mode trigger function', $q$SELECT public.sync_location_mode()$q$);
RESET ROLE;
INSERT INTO public.t_results SELECT 'p5: city lookup is seeded', count(*) = 44, count(*)::text FROM public.city_centroids;

-- 2. Input validation: nothing is stored on rejection --------------------------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub = '61000000-0000-0000-0000-000000000001';
CALL public.expect_fail('p5: unknown city rejected', $q$SELECT public.set_my_location_selection('manual', 'Atlantis')$q$);
CALL public.expect_fail('p5: NULL city rejected', $q$SELECT public.set_my_location_selection('manual', NULL)$q$);
CALL public.expect_fail('p5: empty city rejected', $q$SELECT public.set_my_location_selection('manual', '   ')$q$);
CALL public.expect_fail('p5: invalid mode rejected', $q$SELECT public.set_my_location_selection('gps', 'Pune')$q$);
CALL public.expect_fail('p5: NULL mode rejected', $q$SELECT public.set_my_location_selection(NULL, 'Pune')$q$);
CALL public.expect_fail('p5: manual mode with coordinates rejected',
  $q$SELECT public.set_my_location_selection('manual', 'Pune', 18.52, 73.86, 10)$q$);
CALL public.expect_fail('p5: current mode without coordinates rejected',
  $q$SELECT public.set_my_location_selection('current', 'Pune')$q$);
CALL public.expect_fail('p5: current mode with NaN coordinates rejected',
  $q$SELECT public.set_my_location_selection('current', 'Pune', 'NaN'::float8, 73.86, 10)$q$);
CALL public.expect_fail('p5: current mode with out-of-range latitude rejected',
  $q$SELECT public.set_my_location_selection('current', 'Pune', 95, 73.86, 10)$q$);
RESET ROLE;
INSERT INTO public.t_results SELECT 'p5: rejected requests stored nothing',
  count(*) = 0, count(*)::text FROM public.discovery_locations WHERE user_id = '61000000-0000-0000-0000-000000000001';

-- 3. Manual mode ---------------------------------------------------------------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub = '61000000-0000-0000-0000-000000000001';
SELECT public.set_my_location_selection('manual', '  mumbai ');
RESET ROLE;
INSERT INTO public.t_results SELECT 'p5: manual selection stores the canonical city name',
  city = 'Mumbai', city FROM public.profiles WHERE id = '61000000-0000-0000-0000-000000000001';
SET ROLE authenticated; SET request.jwt.claim.sub = '61000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'p5: selection read model reports manual mode with no stored location',
  s->>'mode' = 'manual' AND s->>'city' = 'Mumbai' AND (s->>'has_location')::boolean = false, s::text
  FROM (SELECT public.get_my_location_selection() s) q;

-- 4. Current mode: city + coordinates in one transaction -------------------------------------------------------------
SELECT public.set_my_location_selection('current', 'Pune', 18.520411, 73.856744, 20);
RESET ROLE;
INSERT INTO public.t_results SELECT 'p5: current mode replaces the manual city and stores snapped coordinates',
  p.city = 'Pune' AND l.latitude = 18.52 AND l.longitude = 73.86, p.city || ' ' || l.latitude || ',' || l.longitude
  FROM public.profiles p JOIN public.discovery_locations l ON l.user_id = p.user_id
  WHERE p.id = '61000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'p5: trigger keeps the stored mode at current',
  location_mode = 'current', location_mode FROM public.discovery_location_settings
  WHERE user_id = '61000000-0000-0000-0000-000000000001';
SET ROLE authenticated; SET request.jwt.claim.sub = '61000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'p5: read model reports current mode, fresh, and never returns coordinates',
  s->>'mode' = 'current' AND s->>'city' = 'Pune' AND (s->>'has_location')::boolean
  AND NOT (s->>'stale')::boolean AND NOT (s ? 'latitude') AND NOT (s ? 'longitude')
  AND s::text !~ '18\.5|73\.8', s::text
  FROM (SELECT public.get_my_location_selection() s) q;

-- 5. A city that does not match the device position is refused, and nothing changes -------------------------------
CALL public.expect_fail('p5: city far from the coordinates is refused (city_mismatch)',
  $q$SELECT public.set_my_location_selection('current', 'Delhi', 18.52, 73.86, 10)$q$);
-- 6. Atomicity: a failure after the city check (bad accuracy) rolls the whole change back ------------------------------
CALL public.expect_fail('p5: bad accuracy fails the whole request',
  $q$SELECT public.set_my_location_selection('current', 'Mumbai', 18.52, 73.86, 6000)$q$);
RESET ROLE;
INSERT INTO public.t_results SELECT 'p5: failed requests changed neither city nor coordinates',
  p.city = 'Pune' AND l.latitude = 18.52 AND l.longitude = 73.86, p.city
  FROM public.profiles p JOIN public.discovery_locations l ON l.user_id = p.user_id
  WHERE p.id = '61000000-0000-0000-0000-000000000001';

-- 7. current -> manual clears the coordinates and flips the mode -------------------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub = '61000000-0000-0000-0000-000000000001';
SELECT public.set_my_location_selection('manual', 'Delhi');
RESET ROLE;
INSERT INTO public.t_results SELECT 'p5: manual selection clears stored coordinates',
  count(*) = 0, count(*)::text FROM public.discovery_locations WHERE user_id = '61000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'p5: trigger flips the stored mode back to manual and the city is Delhi',
  s.location_mode = 'manual' AND p.city = 'Delhi', s.location_mode || ' ' || p.city
  FROM public.discovery_location_settings s JOIN public.profiles p ON p.user_id = s.user_id
  WHERE s.user_id = '61000000-0000-0000-0000-000000000001';
-- re-selecting is idempotent
SET ROLE authenticated; SET request.jwt.claim.sub = '61000000-0000-0000-0000-000000000001';
SELECT public.set_my_location_selection('manual', 'Delhi');
RESET ROLE;
INSERT INTO public.t_results SELECT 'p5: repeating a manual selection is harmless',
  count(*) = 1, count(*)::text FROM public.profiles WHERE id = '61000000-0000-0000-0000-000000000001' AND city = 'Delhi';

-- 8. Consent is still enforced for current mode (u2 never granted it), and u2's city is untouched ------------------
SET ROLE authenticated; SET request.jwt.claim.sub = '61000000-0000-0000-0000-000000000002';
CALL public.expect_fail('p5: current mode needs location consent',
  $q$SELECT public.set_my_location_selection('current', 'Pune', 18.52, 73.86, 10)$q$);
SELECT public.set_my_location_selection('manual', 'Chennai');   -- manual needs no location consent
RESET ROLE;
INSERT INTO public.t_results SELECT 'p5: no consent: coordinates were not stored, manual city still works',
  (SELECT count(*) FROM public.discovery_locations WHERE user_id = '61000000-0000-0000-0000-000000000002') = 0
  AND (SELECT city FROM public.profiles WHERE id = '61000000-0000-0000-0000-000000000002') = 'Chennai', 'no consent';

-- 9. Members only ever change their own selection -------------------------------------------------------------------------
INSERT INTO public.t_results SELECT 'p5: u1 selection did not touch u2 or u3',
  (SELECT city FROM public.profiles WHERE id = '61000000-0000-0000-0000-000000000002') = 'Chennai'
  AND (SELECT city FROM public.profiles WHERE id = '61000000-0000-0000-0000-000000000003') = 'Pune', 'isolated';

-- 10. Mode triggers also cover direct row changes (legacy RPC, consent withdrawal, retention) ---------------------------
INSERT INTO public.discovery_locations (user_id, latitude, longitude)
VALUES ('61000000-0000-0000-0000-000000000003', 18.52, 73.86);
INSERT INTO public.t_results SELECT 'p5: inserting coordinates directly marks the mode current',
  location_mode = 'current', location_mode FROM public.discovery_location_settings
  WHERE user_id = '61000000-0000-0000-0000-000000000003';
DELETE FROM public.discovery_locations WHERE user_id = '61000000-0000-0000-0000-000000000003';
INSERT INTO public.t_results SELECT 'p5: deleting coordinates directly marks the mode manual',
  location_mode = 'manual', location_mode FROM public.discovery_location_settings
  WHERE user_id = '61000000-0000-0000-0000-000000000003';
