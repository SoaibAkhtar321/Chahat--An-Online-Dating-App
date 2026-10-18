\set ON_ERROR_STOP on
-- 48_location_privacy.sql: coarse storage, bucketed distances (feed/radius/cursor/get_distance_to), hide-distance,
-- probing resistance, abuse controls, authorization, and account-deletion cleanup.
-- Complements 39_location_discovery.sql (which keeps covering the original behaviour).

INSERT INTO auth.users(id,email) VALUES
 ('90000000-0000-0000-0000-000000000001','p1@x'),('90000000-0000-0000-0000-000000000002','p2@x'),
 ('90000000-0000-0000-0000-000000000003','p3@x'),('90000000-0000-0000-0000-000000000004','p4@x'),
 ('90000000-0000-0000-0000-000000000005','p5@x'),('90000000-0000-0000-0000-000000000006','p6@x'),
 ('90000000-0000-0000-0000-000000000007','p7@x'),('90000000-0000-0000-0000-000000000008','p8@x'),
 ('90000000-0000-0000-0000-000000000009','p9@x');

-- Step 3: storing a discovery location requires the user's location consent (see 52_optional_consents.sql).
INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
SELECT id, 'location_discovery', '2026-10-18', 'granted', 'in_app_notice'
FROM auth.users WHERE id::text LIKE '90000000%';

INSERT INTO storage.objects (bucket_id, name, owner)
SELECT 'photos', id || '/location.jpg', id::uuid FROM public.profiles WHERE id LIKE '90000000%';

-- viewer p1 (man, Pune, seeks women); the others are women
UPDATE public.profiles
SET name = 'Member', dob = '1996-01-01', gender = 'woman', seeking = 'man', city = 'Pune',
    bio = 'A complete location privacy profile.', intents = ARRAY['Friendship'],
    interests = ARRAY['Books', 'Coffee', 'Music'], languages = ARRAY['English'],
    photos = jsonb_build_array(jsonb_build_object('id', 'loc-priv', 'path', id || '/location.jpg', 'thumbPath', id || '/location.jpg')),
    onboarded = true
WHERE id LIKE '90000000%';
UPDATE public.profiles SET name='Viewer', gender='man', seeking='woman'
 WHERE id='90000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET city='Mumbai' WHERE id='90000000-0000-0000-0000-000000000003';

-- 1. anon cannot call anything -------------------------------------------------------------------------------------
SET ROLE anon;
CALL public.expect_fail('anon cannot set_my_discovery_location','SELECT public.set_my_discovery_location(18.5,73.8,10)');
CALL public.expect_fail('anon cannot set_distance_sharing','SELECT public.set_distance_sharing(false)');
CALL public.expect_fail('anon cannot get_my_location_status','SELECT public.get_my_location_status()');
CALL public.expect_fail('anon cannot get_distance_to','SELECT public.get_distance_to(''x'')');
RESET ROLE;

-- 2. authenticated: no direct table access, no internal helpers, input validation --------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000001';
CALL public.expect_fail('authenticated cannot read location settings','SELECT * FROM public.discovery_location_settings');
CALL public.expect_fail('authenticated cannot write location settings','UPDATE public.discovery_location_settings SET share_distance=false');
CALL public.expect_fail('authenticated cannot call haversine_km','SELECT public.haversine_km(1,1,2,2)');
CALL public.expect_fail('authenticated cannot call distance_bucket_km','SELECT public.distance_bucket_km(5)');
CALL public.expect_fail('NaN latitude rejected','SELECT public.set_my_discovery_location(''NaN''::float8,73,10)');
CALL public.expect_fail('NULL coordinates rejected','SELECT public.set_my_discovery_location(NULL,NULL,10)');
CALL public.expect_fail('accuracy > 5000 m rejected','SELECT public.set_my_discovery_location(18.5,73.8,6000)');
CALL public.expect_fail('negative accuracy rejected','SELECT public.set_my_discovery_location(18.5,73.8,-1)');
CALL public.expect_fail('NULL sharing value rejected','SELECT public.set_distance_sharing(NULL)');
RESET ROLE;
INSERT INTO public.t_results SELECT 'rejected requests stored nothing', count(*)=0, count(*)::text
  FROM public.discovery_locations WHERE user_id='90000000-0000-0000-0000-000000000001';

-- 3. Coarse storage ---------------------------------------------------------------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000001';
SELECT public.set_my_discovery_location(18.520411, 73.856744, 20);
DO $$ DECLARE s jsonb; BEGIN
  s := public.get_my_location_status();
  INSERT INTO public.t_results VALUES ('status reports a fresh location without coordinates',
    (s->>'has_location')::boolean AND NOT (s->>'stale')::boolean AND (s->>'share_distance')::boolean
    AND NOT (s ? 'lat') AND NOT (s ? 'latitude') AND NOT (s::text ~ '18\.5|73\.8'), s::text);
END $$;
RESET ROLE;
INSERT INTO public.t_results SELECT 'precise coordinates never stored (snapped to 2 decimals)',
  latitude=18.52 AND longitude=73.86, latitude||','||longitude
  FROM public.discovery_locations WHERE user_id='90000000-0000-0000-0000-000000000001';

-- other members --------------------------------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000002'; SELECT public.set_my_discovery_location(18.5600,73.8567,15);
SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000003'; SELECT public.set_my_discovery_location(19.0760,72.8777,15);
SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000004'; SELECT public.set_my_discovery_location(18.6000,73.8600,15); SELECT public.set_distance_sharing(false);
RESET ROLE;
-- 80-hour-old fix: must be ignored everywhere
INSERT INTO public.discovery_locations(user_id,latitude,longitude,updated_at)
VALUES ('90000000-0000-0000-0000-000000000005',18.53,73.86,now()-interval '80 hours');

-- 4. Discovery: bucketed distance, radius, cursor ------------------------------------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'feed: near profile distance is bucketed (4-6 km)',
  count(*)=1 AND bool_and(distance_km BETWEEN 4 AND 6), coalesce(max(distance_km)::text,'none')
  FROM public.get_discovery_feed_page(50,18,99,500,'{}','{}','{}',NULL,NULL) WHERE id='90000000-0000-0000-0000-000000000002';
INSERT INTO public.t_results SELECT 'feed: far profile bucket is a multiple of 5 (110-130 km)',
  count(*)=1 AND bool_and(distance_km BETWEEN 110 AND 130 AND distance_km % 5 = 0), coalesce(max(distance_km)::text,'none')
  FROM public.get_discovery_feed_page(50,18,99,500,'{}','{}','{}',NULL,NULL) WHERE id='90000000-0000-0000-0000-000000000003';
INSERT INTO public.t_results SELECT 'feed: cursor exposes only the bucket, never exact metres',
  bool_and(cursor_distance_m % 1000 = 0), string_agg(cursor_distance_m::text, ',')
  FROM public.get_discovery_feed_page(50,18,99,500,'{}','{}','{}',NULL,NULL);
INSERT INTO public.t_results SELECT 'feed: nearest first (Near before Far)',
  (SELECT array_position(array_agg(id ORDER BY ord), '90000000-0000-0000-0000-000000000002')
        < array_position(array_agg(id ORDER BY ord), '90000000-0000-0000-0000-000000000003')
   FROM (SELECT id, row_number() OVER () ord FROM public.get_discovery_feed_page(50,18,99,500,'{}','{}','{}',NULL,NULL)) q), 'order';
INSERT INTO public.t_results SELECT 'feed radius 50: includes Near, excludes Far',
  EXISTS(SELECT 1 FROM public.get_discovery_feed_page(50,18,99,50,'{}','{}','{}',NULL,NULL) WHERE id='90000000-0000-0000-0000-000000000002')
  AND NOT EXISTS(SELECT 1 FROM public.get_discovery_feed_page(50,18,99,50,'{}','{}','{}',NULL,NULL) WHERE id='90000000-0000-0000-0000-000000000003'), 'radius';
INSERT INTO public.t_results SELECT 'feed radius 200 includes Far',
  EXISTS(SELECT 1 FROM public.get_discovery_feed_page(50,18,99,200,'{}','{}','{}',NULL,NULL) WHERE id='90000000-0000-0000-0000-000000000003'), 'radius200';
INSERT INTO public.t_results SELECT 'feed: radius filter follows the bucket (a 6 km neighbour is excluded at radius 3, included at 6)',
  NOT EXISTS(SELECT 1 FROM public.get_discovery_feed_page(50,18,99,3,'{}','{}','{}',NULL,NULL) WHERE id='90000000-0000-0000-0000-000000000002')
  AND EXISTS(SELECT 1 FROM public.get_discovery_feed_page(50,18,99,6,'{}','{}','{}',NULL,NULL) WHERE id='90000000-0000-0000-0000-000000000002'), 'bucket radius';
INSERT INTO public.t_results SELECT 'feed: hidden-distance member shows no distance',
  count(*)=1 AND bool_and(distance_km IS NULL), count(*)::text
  FROM public.get_discovery_feed_page(50,18,99,500,'{}','{}','{}',NULL,NULL) WHERE id='90000000-0000-0000-0000-000000000004';
INSERT INTO public.t_results SELECT 'feed: radius sweep cannot pinpoint a hidden member (~11 km granularity, still included at radius 20)',
  EXISTS(SELECT 1 FROM public.get_discovery_feed_page(50,18,99,20,'{}','{}','{}',NULL,NULL) WHERE id='90000000-0000-0000-0000-000000000004'), 'probe';
INSERT INTO public.t_results SELECT 'feed: 80-hour-old fix is ignored (no distance row for it)',
  NOT EXISTS(SELECT 1 FROM public.get_discovery_feed_page(50,18,99,500,'{}','{}','{}',NULL,NULL) WHERE id='90000000-0000-0000-0000-000000000005'), 'stale';

-- get_distance_to ---------------------------------------------------------------------------------------------------------
INSERT INTO public.t_results SELECT 'get_distance_to near is bucketed (4-6 km)',
  public.get_distance_to('90000000-0000-0000-0000-000000000002') BETWEEN 4 AND 6,
  coalesce(public.get_distance_to('90000000-0000-0000-0000-000000000002')::text,'null');
INSERT INTO public.t_results SELECT 'get_distance_to hidden member is NULL', public.get_distance_to('90000000-0000-0000-0000-000000000004') IS NULL, 'hidden';
INSERT INTO public.t_results SELECT 'get_distance_to stale member is NULL', public.get_distance_to('90000000-0000-0000-0000-000000000005') IS NULL, 'stale';
INSERT INTO public.t_results SELECT 'get_distance_to self is NULL', public.get_distance_to('90000000-0000-0000-0000-000000000001') IS NULL, 'self';
INSERT INTO public.t_results SELECT 'get_distance_to unknown id is NULL', public.get_distance_to('no-such-id') IS NULL, 'unknown';
RESET ROLE;

-- blocked pair: excluded from get_distance_to
INSERT INTO public.blocks(blocker,blocked) VALUES ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002');
SET ROLE authenticated; SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'get_distance_to blocked member is NULL', public.get_distance_to('90000000-0000-0000-0000-000000000002') IS NULL, 'blocked';
RESET ROLE;

-- viewer with no fresh location gets NULL distances
SET ROLE authenticated; SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000006';
INSERT INTO public.t_results SELECT 'get_distance_to without own location is NULL', public.get_distance_to('90000000-0000-0000-0000-000000000003') IS NULL, 'no origin';
RESET ROLE;

-- 5. Privacy controls: sharing preference survives removing the location -------------------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000001';
SELECT public.set_distance_sharing(false);
SELECT public.clear_my_discovery_location();
DO $$ DECLARE s jsonb; BEGIN s := public.get_my_location_status();
  INSERT INTO public.t_results VALUES ('clearing location keeps the sharing preference',
    NOT (s->>'has_location')::boolean AND NOT (s->>'share_distance')::boolean, s::text); END $$;
RESET ROLE;
INSERT INTO public.t_results SELECT 'cleared location leaves no coordinates behind', count(*)=0, count(*)::text
  FROM public.discovery_locations WHERE user_id='90000000-0000-0000-0000-000000000001';

-- 6. Abuse controls -------------------------------------------------------------------------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000007';
SELECT public.set_my_discovery_location(18.52,73.86,10);
CALL public.expect_fail('implausible movement (Pune -> Delhi instantly) rejected','SELECT public.set_my_discovery_location(28.61,77.21,10)');
CALL public.expect_ok('plausible short move accepted','SELECT public.set_my_discovery_location(18.60,73.90,10)');
SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000008';
DO $$ BEGIN FOR i IN 1..12 LOOP PERFORM public.set_my_discovery_location(18.52,73.86,10); END LOOP; END $$;
CALL public.expect_fail('13th update within an hour is rate limited','SELECT public.set_my_discovery_location(18.52,73.86,10)');
RESET ROLE;

-- 7. Account-deletion cleanup -----------------------------------------------------------------------------------------------------
SET ROLE authenticated; SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000009';
SELECT public.set_my_discovery_location(18.52,73.86,10); SELECT public.set_distance_sharing(false);
RESET ROLE;
INSERT INTO public.t_results SELECT 'location and settings exist before purge',
  (SELECT count(*) FROM public.discovery_locations WHERE user_id='90000000-0000-0000-0000-000000000009')=1
  AND (SELECT count(*) FROM public.discovery_location_settings WHERE user_id='90000000-0000-0000-0000-000000000009')=1, 'before';
SELECT public.purge_user_data('90000000-0000-0000-0000-000000000009');
INSERT INTO public.t_results SELECT 'purge_user_data removes stored location and settings',
  (SELECT count(*) FROM public.discovery_locations WHERE user_id='90000000-0000-0000-0000-000000000009')=0
  AND (SELECT count(*) FROM public.discovery_location_settings WHERE user_id='90000000-0000-0000-0000-000000000009')=0, 'after purge';
-- auth-user deletion cascades as well
SET ROLE authenticated; SET request.jwt.claim.sub='90000000-0000-0000-0000-000000000008'; SELECT public.set_distance_sharing(false); RESET ROLE;
DELETE FROM auth.users WHERE id='90000000-0000-0000-0000-000000000008';
INSERT INTO public.t_results SELECT 'auth user deletion cascades to location tables',
  (SELECT count(*) FROM public.discovery_locations WHERE user_id='90000000-0000-0000-0000-000000000008')=0
  AND (SELECT count(*) FROM public.discovery_location_settings WHERE user_id='90000000-0000-0000-0000-000000000008')=0, 'cascade';

-- 8. Existing rows are snapped by the migration's UPDATE (simulated) ---------------------------------------------------------------------
INSERT INTO public.t_results SELECT 'no stored coordinate has more than 2 decimals',
  NOT EXISTS (SELECT 1 FROM public.discovery_locations
              WHERE user_id::text LIKE '90000000%'
                AND (latitude <> round(latitude::numeric,2) OR longitude <> round(longitude::numeric,2))), 'snapped';
