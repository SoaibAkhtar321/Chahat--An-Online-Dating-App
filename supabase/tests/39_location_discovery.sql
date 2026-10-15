\set ON_ERROR_STOP on
-- Private location writes, distance filtering, authorization, and cursor ordering.

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'loc-a@x'),
  ('00000000-0000-0000-0000-0000000000c2', 'loc-b@x'),
  ('00000000-0000-0000-0000-0000000000c3', 'loc-c@x'),
  ('00000000-0000-0000-0000-0000000000c4', 'loc-d@x');

UPDATE public.profiles
SET name = 'Location User', dob = '1995-01-01', gender = 'man', seeking = 'woman',
    city = 'Pune', onboarded = true
WHERE id = '00000000-0000-0000-0000-0000000000c1';
UPDATE public.profiles
SET name = 'Nearby User', dob = '1996-01-01', gender = 'woman', seeking = 'man',
    city = 'Mumbai', onboarded = true
WHERE id IN ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c4');
UPDATE public.profiles
SET name = 'Far User', dob = '1996-01-01', gender = 'woman', seeking = 'man',
    city = 'Bengaluru', onboarded = true
WHERE id = '00000000-0000-0000-0000-0000000000c3';

INSERT INTO public.discovery_locations(user_id, latitude, longitude)
VALUES
  ('00000000-0000-0000-0000-0000000000c2', 0.1, 0),
  ('00000000-0000-0000-0000-0000000000c3', 1, 0),
  ('00000000-0000-0000-0000-0000000000c4', 0.1, 0);

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
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
  count(*) = 1 AND bool_and(id = '00000000-0000-0000-0000-0000000000c2'),
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
  count(*) = 1 AND bool_and(id = '00000000-0000-0000-0000-0000000000c4'),
  coalesce(string_agg(id, ','), 'empty')
FROM location_page_two;
INSERT INTO public.t_results
SELECT 'outside radius is excluded',
  count(*) = 0, count(*)::text
FROM public.get_discovery_feed_page(50, 18, 99, 50, '{}', '{}', '{}', NULL, NULL)
WHERE id = '00000000-0000-0000-0000-0000000000c3';
RESET ROLE;

INSERT INTO public.blocks(blocker, blocked)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c4');
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
INSERT INTO public.t_results
SELECT 'blocked profile excluded from location discovery',
  count(*) = 0, count(*)::text
FROM public.get_discovery_feed_page(50, 18, 99, 50, '{}', '{}', '{}', NULL, NULL)
WHERE id = '00000000-0000-0000-0000-0000000000c4';
SELECT public.clear_my_discovery_location();
INSERT INTO public.t_results SELECT
  'disabling location deletes the precise row', NOT public.has_my_discovery_location(), 'cleared';
RESET ROLE;
