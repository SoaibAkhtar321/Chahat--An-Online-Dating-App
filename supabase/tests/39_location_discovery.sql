\set ON_ERROR_STOP on
-- Private location writes, distance filtering, authorization, and cursor ordering.

INSERT INTO auth.users(id, email) VALUES
  ('50000000-0000-0000-0000-000000000001', 'loc-a@x'),
  ('50000000-0000-0000-0000-000000000002', 'loc-b@x'),
  ('50000000-0000-0000-0000-000000000003', 'loc-c@x'),
  ('50000000-0000-0000-0000-000000000004', 'loc-d@x');
-- Step 3: storing a discovery location requires the user's location consent (see 52_optional_consents.sql).
INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
SELECT id, 'location_discovery', '2026-10-18', 'granted', 'in_app_notice'
FROM auth.users WHERE id::text LIKE '50000000%';

INSERT INTO storage.objects (bucket_id, name, owner)
SELECT 'photos', id || '/location.jpg', id::uuid
FROM public.profiles
WHERE id IN (
  '50000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000002',
  '50000000-0000-0000-0000-000000000003',
  '50000000-0000-0000-0000-000000000004'
);

UPDATE public.profiles
SET name = 'Location User', dob = '1995-01-01', gender = 'man', seeking = 'woman',
    city = 'Pune', bio = 'A complete location discovery profile.',
    intents = ARRAY['Friendship'], interests = ARRAY['Books', 'Coffee', 'Music'],
    languages = ARRAY['English'],
    photos = jsonb_build_array(jsonb_build_object(
      'id', 'location-test', 'path', id || '/location.jpg', 'thumbPath', id || '/location.jpg'
    )),
    onboarded = true
WHERE id = '50000000-0000-0000-0000-000000000001';
UPDATE public.profiles
SET name = 'Nearby User', dob = '1996-01-01', gender = 'woman', seeking = 'man',
    city = 'Mumbai', bio = 'A complete location discovery profile.',
    intents = ARRAY['Friendship'], interests = ARRAY['Books', 'Coffee', 'Music'],
    languages = ARRAY['English'],
    photos = jsonb_build_array(jsonb_build_object(
      'id', 'location-test', 'path', id || '/location.jpg', 'thumbPath', id || '/location.jpg'
    )),
    onboarded = true
WHERE id IN ('50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000004');
UPDATE public.profiles
SET name = 'Far User', dob = '1996-01-01', gender = 'woman', seeking = 'man',
    city = 'Bengaluru', bio = 'A complete location discovery profile.',
    intents = ARRAY['Friendship'], interests = ARRAY['Books', 'Coffee', 'Music'],
    languages = ARRAY['English'],
    photos = jsonb_build_array(jsonb_build_object(
      'id', 'location-test', 'path', id || '/location.jpg', 'thumbPath', id || '/location.jpg'
    )),
    onboarded = true
WHERE id = '50000000-0000-0000-0000-000000000003';

INSERT INTO public.discovery_locations(user_id, latitude, longitude)
VALUES
  ('50000000-0000-0000-0000-000000000002', 0.1, 0),
  ('50000000-0000-0000-0000-000000000003', 1, 0),
  ('50000000-0000-0000-0000-000000000004', 0.1, 0);

SET ROLE authenticated;
SET request.jwt.claim.sub = '50000000-0000-0000-0000-000000000001';
SELECT public.set_my_discovery_location(0, 0);
INSERT INTO public.t_results SELECT
  'owner can enable own precise location', public.has_my_discovery_location(), 'enabled';
CALL public.expect_fail('invalid latitude rejected',
  'SELECT public.set_my_discovery_location(91, 0)');
CALL public.expect_fail('invalid longitude rejected',
  'SELECT public.set_my_discovery_location(0, 181)');
CALL public.expect_fail('precise location table not readable by authenticated client',
  'SELECT * FROM public.discovery_locations');

CREATE TEMP TABLE location_page_one AS
SELECT id, cursor_distance_m FROM public.get_discovery_feed_page(
  1, 18, 99, 50, '{}', '{}', '{}', NULL, NULL
);
INSERT INTO public.t_results
SELECT 'nearby profiles returned in first stable page',
  count(*) = 1 AND bool_and(id = '50000000-0000-0000-0000-000000000002'),
  coalesce(string_agg(id, ','), 'empty')
FROM location_page_one;

CREATE TEMP TABLE location_page_two AS
SELECT id FROM public.get_discovery_feed_page(
  1, 18, 99, 50, '{}', '{}', '{}',
  (SELECT cursor_distance_m FROM location_page_one),
  (SELECT id FROM location_page_one)
);
INSERT INTO public.t_results
SELECT 'next cursor returns distinct tied-distance profile',
  count(*) = 1 AND bool_and(id = '50000000-0000-0000-0000-000000000004'),
  coalesce(string_agg(id, ','), 'empty')
FROM location_page_two;
INSERT INTO public.t_results
SELECT 'outside radius is excluded',
  count(*) = 0, count(*)::text
FROM public.get_discovery_feed_page(50, 18, 99, 50, '{}', '{}', '{}', NULL, NULL)
WHERE id = '50000000-0000-0000-0000-000000000003';
RESET ROLE;

INSERT INTO public.blocks(blocker, blocked)
VALUES ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004');
SET ROLE authenticated;
SET request.jwt.claim.sub = '50000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results
SELECT 'blocked profile excluded from location discovery',
  count(*) = 0, count(*)::text
FROM public.get_discovery_feed_page(50, 18, 99, 50, '{}', '{}', '{}', NULL, NULL)
WHERE id = '50000000-0000-0000-0000-000000000004';
SELECT public.clear_my_discovery_location();
INSERT INTO public.t_results SELECT
  'disabling location deletes the precise row', NOT public.has_my_discovery_location(), 'cleared';
RESET ROLE;
