-- 20260101004300_location_selection_and_city_anchor.sql
-- Phase 5: one authoritative location selection, and discovery ranked by real distance.
--   1. city_centroids: closed lookup of supported cities (name -> approximate centre). Used as the location
--      anchor when a member has no device coordinates, and to validate every selected city.
--   2. discovery_location_settings.location_mode ('manual' | 'current'), kept in sync by triggers on
--      discovery_locations so the mode can never disagree with whether coordinates are stored.
--   3. set_my_location_selection(): ONE transaction that validates and writes mode + city + coordinates.
--   4. get_my_location_selection(): what the clients render (never coordinates).
--   5. get_discovery_feed_page(): ranked by bucketed distance (device coordinates, else city centre), no strict
--      city match, expansion = ordering nearest-first within the member's maximum radius. Adds distance_basis.
-- Existing migrations are not edited. Nothing here exposes exact coordinates.
BEGIN;

-- ---------- 1. City lookup ----------
CREATE OR REPLACE FUNCTION public.normalize_city_key(_city text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(btrim(regexp_replace(coalesce(_city, ''), '\s+', ' ', 'g')))
$$;

CREATE TABLE IF NOT EXISTS public.city_centroids (
  name_key     text PRIMARY KEY CHECK (name_key = public.normalize_city_key(name_key) AND name_key <> ''),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  latitude     double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude    double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180)
);
ALTER TABLE public.city_centroids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.city_centroids FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.city_centroids TO service_role;

INSERT INTO public.city_centroids (name_key, display_name, latitude, longitude) VALUES
  ('mumbai', 'Mumbai', 19.08, 72.88),
  ('delhi', 'Delhi', 28.61, 77.21),
  ('bengaluru', 'Bengaluru', 12.97, 77.59),
  ('hyderabad', 'Hyderabad', 17.39, 78.49),
  ('chennai', 'Chennai', 13.08, 80.27),
  ('kolkata', 'Kolkata', 22.57, 88.36),
  ('pune', 'Pune', 18.52, 73.86),
  ('jaipur', 'Jaipur', 26.91, 75.79),
  ('ahmedabad', 'Ahmedabad', 23.02, 72.57),
  ('lucknow', 'Lucknow', 26.85, 80.95),
  ('chandigarh', 'Chandigarh', 30.73, 76.78),
  ('surat', 'Surat', 21.17, 72.83),
  ('kochi', 'Kochi', 9.93, 76.27),
  ('indore', 'Indore', 22.72, 75.86),
  ('bhopal', 'Bhopal', 23.26, 77.41),
  ('nagpur', 'Nagpur', 21.15, 79.09),
  ('patna', 'Patna', 25.59, 85.14),
  ('vadodara', 'Vadodara', 22.31, 73.18),
  ('coimbatore', 'Coimbatore', 11.02, 76.96),
  ('visakhapatnam', 'Visakhapatnam', 17.69, 83.22),
  ('thiruvananthapuram', 'Thiruvananthapuram', 8.52, 76.94),
  ('gurugram', 'Gurugram', 28.46, 77.03),
  ('noida', 'Noida', 28.54, 77.39),
  ('ghaziabad', 'Ghaziabad', 28.67, 77.42),
  ('faridabad', 'Faridabad', 28.41, 77.31),
  ('kanpur', 'Kanpur', 26.45, 80.35),
  ('agra', 'Agra', 27.18, 78.01),
  ('varanasi', 'Varanasi', 25.32, 83.01),
  ('amritsar', 'Amritsar', 31.63, 74.87),
  ('ludhiana', 'Ludhiana', 30.9, 75.86),
  ('jodhpur', 'Jodhpur', 26.24, 73.02),
  ('udaipur', 'Udaipur', 24.59, 73.71),
  ('nashik', 'Nashik', 19.99, 73.79),
  ('mysuru', 'Mysuru', 12.3, 76.64),
  ('mangaluru', 'Mangaluru', 12.91, 74.86),
  ('bhubaneswar', 'Bhubaneswar', 20.3, 85.82),
  ('guwahati', 'Guwahati', 26.14, 91.74),
  ('ranchi', 'Ranchi', 23.34, 85.31),
  ('raipur', 'Raipur', 21.25, 81.63),
  ('dehradun', 'Dehradun', 30.32, 78.03),
  ('panaji', 'Panaji', 15.5, 73.83),
  ('madurai', 'Madurai', 9.93, 78.12),
  ('thane', 'Thane', 19.22, 72.98),
  ('navi mumbai', 'Navi Mumbai', 19.03, 73.03)
ON CONFLICT (name_key) DO UPDATE
  SET display_name = EXCLUDED.display_name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude;

CREATE INDEX IF NOT EXISTS profiles_city_key_idx
  ON public.profiles (public.normalize_city_key(city))
  WHERE status = 'active' AND onboarded;

-- ---------- 2. Explicit mode, maintained by triggers ----------
ALTER TABLE public.discovery_location_settings
  ADD COLUMN IF NOT EXISTS location_mode text NOT NULL DEFAULT 'manual'
  CHECK (location_mode IN ('manual', 'current'));

INSERT INTO public.discovery_location_settings (user_id, location_mode)
SELECT l.user_id, 'current' FROM public.discovery_locations l
ON CONFLICT (user_id) DO UPDATE SET location_mode = 'current';

CREATE OR REPLACE FUNCTION public.sync_location_mode()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.discovery_location_settings SET location_mode = 'manual' WHERE user_id = OLD.user_id;
    RETURN OLD;
  END IF;
  INSERT INTO public.discovery_location_settings (user_id, location_mode) VALUES (NEW.user_id, 'current')
  ON CONFLICT (user_id) DO UPDATE SET location_mode = 'current';
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.sync_location_mode() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS discovery_locations_sync_mode ON public.discovery_locations;
CREATE TRIGGER discovery_locations_sync_mode
  AFTER INSERT OR UPDATE OR DELETE ON public.discovery_locations
  FOR EACH ROW EXECUTE FUNCTION public.sync_location_mode();

-- ---------- 3. Atomic selection ----------
CREATE OR REPLACE FUNCTION public.set_my_location_selection(
  _mode text,
  _city text,
  _latitude double precision DEFAULT NULL,
  _longitude double precision DEFAULT NULL,
  _accuracy_m integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _c public.city_centroids;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _mode IS NULL OR _mode NOT IN ('manual', 'current') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  IF _city IS NULL OR char_length(_city) > 80 THEN RAISE EXCEPTION 'unknown_city'; END IF;

  SELECT * INTO _c FROM public.city_centroids WHERE name_key = public.normalize_city_key(_city);
  IF _c.name_key IS NULL THEN RAISE EXCEPTION 'unknown_city'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _uid::text AND user_id = _uid AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active profile required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('discovery_loc:' || _uid::text, 0));

  IF _mode = 'manual' THEN
    -- A manual city never coexists with stored coordinates.
    IF _latitude IS NOT NULL OR _longitude IS NOT NULL OR _accuracy_m IS NOT NULL THEN
      RAISE EXCEPTION 'coordinates_not_allowed';
    END IF;
    UPDATE public.profiles SET city = _c.display_name WHERE id = _uid::text AND user_id = _uid;
    DELETE FROM public.discovery_locations WHERE user_id = _uid;   -- trigger sets mode = 'manual'
    INSERT INTO public.discovery_location_settings (user_id, location_mode) VALUES (_uid, 'manual')
    ON CONFLICT (user_id) DO UPDATE SET location_mode = 'manual';
  ELSE
    IF _latitude IS NULL OR _longitude IS NULL THEN RAISE EXCEPTION 'Invalid coordinates'; END IF;
    -- The city must be where the device actually is (150 km tolerance for the nearest supported city).
    IF _latitude = 'NaN'::float8 OR _longitude = 'NaN'::float8
       OR _latitude NOT BETWEEN -90 AND 90 OR _longitude NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'Invalid coordinates';
    END IF;
    IF public.haversine_km(_latitude, _longitude, _c.latitude, _c.longitude) > 150 THEN
      RAISE EXCEPTION 'city_mismatch';
    END IF;
    -- Validation, snapping to ~1 km, rate limiting, movement guard and the consent trigger all live here.
    PERFORM public.set_my_discovery_location(_latitude, _longitude, _accuracy_m);
    UPDATE public.profiles SET city = _c.display_name WHERE id = _uid::text AND user_id = _uid;
  END IF;

  RETURN jsonb_build_object('mode', _mode, 'city', _c.display_name);
END
$$;
REVOKE EXECUTE ON FUNCTION public.set_my_location_selection(text, text, double precision, double precision, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_location_selection(text, text, double precision, double precision, integer)
  TO authenticated;

-- ---------- 4. Read model (never coordinates) ----------
CREATE OR REPLACE FUNCTION public.get_my_location_selection()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _city text;
  _known boolean;
  _mode text;
  _share boolean;
  _updated timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT p.city INTO _city FROM public.profiles p WHERE p.id = _uid::text AND p.user_id = _uid;
  SELECT EXISTS (SELECT 1 FROM public.city_centroids c WHERE c.name_key = public.normalize_city_key(_city))
    INTO _known;
  SELECT s.location_mode, s.share_distance INTO _mode, _share
  FROM public.discovery_location_settings s WHERE s.user_id = _uid;
  SELECT l.updated_at INTO _updated FROM public.discovery_locations l WHERE l.user_id = _uid;
  RETURN jsonb_build_object(
    'mode', CASE WHEN _updated IS NOT NULL THEN 'current' ELSE 'manual' END,
    'city', CASE WHEN _known THEN (SELECT c.display_name FROM public.city_centroids c
                                    WHERE c.name_key = public.normalize_city_key(_city)) ELSE NULL END,
    'has_location', _updated IS NOT NULL,
    'stale', _updated IS NOT NULL AND _updated < now() - interval '72 hours',
    'share_distance', coalesce(_share, true)
  );
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_location_selection() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_location_selection() TO authenticated;

-- ---------- 5. Feed: distance-ranked, city-anchored fallback, nearest-first expansion ----------
DROP FUNCTION IF EXISTS public.get_discovery_feed_page(
  integer, integer, integer, integer, text[], text[], text[], integer, text, integer);

CREATE OR REPLACE FUNCTION public.get_discovery_feed_page(
  _limit integer DEFAULT 20,
  _age_min integer DEFAULT 18,
  _age_max integer DEFAULT 99,
  _radius_km integer DEFAULT 50,
  _intents text[] DEFAULT '{}',
  _interests text[] DEFAULT '{}',
  _languages text[] DEFAULT '{}',
  _after_distance_m integer DEFAULT NULL,
  _after_id text DEFAULT NULL,
  _min_radius_km integer DEFAULT 0
)
RETURNS TABLE (
  id text,
  name text,
  age integer,
  city text,
  bio text,
  work text,
  education text,
  interests text[],
  intents text[],
  languages text[],
  lifestyle jsonb,
  prompt jsonb,
  photos jsonb,
  distance_km integer,
  cursor_distance_m integer,
  distance_basis text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _me public.profiles;
  _origin public.discovery_locations;
  _max_radius integer := public.billing_setting_int('discovery_max_radius_km', 500, 1, 1000);
  _city_lat double precision;
  _city_lng double precision;
  _anchor_lat double precision;
  _anchor_lng double precision;
  _anchor_basis text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _limit IS NULL OR _limit < 1 OR _limit > 50
     OR _age_min IS NULL OR _age_max IS NULL OR _age_min < 18 OR _age_max > 99 OR _age_min > _age_max
     OR _radius_km IS NULL OR _radius_km < 1 OR _radius_km > _max_radius
     OR _min_radius_km IS NULL OR _min_radius_km < 0 OR _min_radius_km >= _radius_km
     OR coalesce(cardinality(_intents), 0) > 6
     OR coalesce(cardinality(_interests), 0) > 10
     OR coalesce(cardinality(_languages), 0) > 16
     OR ((_after_distance_m IS NULL) <> (_after_id IS NULL))
     OR (_after_distance_m IS NOT NULL AND (_after_distance_m < 0 OR char_length(_after_id) > 128)) THEN
    RAISE EXCEPTION 'Invalid discovery filters or cursor';
  END IF;

  SELECT * INTO _me FROM public.profiles p
  WHERE p.id = _uid::text AND p.user_id = _uid AND p.status = 'active';
  IF _me.id IS NULL OR NOT _me.onboarded THEN RAISE EXCEPTION 'Completed active profile required'; END IF;

  SELECT * INTO _origin FROM public.discovery_locations l
  WHERE l.user_id = _uid AND l.updated_at >= now() - interval '72 hours';

  SELECT c.latitude, c.longitude INTO _city_lat, _city_lng
  FROM public.city_centroids c WHERE c.name_key = public.normalize_city_key(_me.city);

  -- Anchor: fresh device coordinates, else the selected city's centre, else none (then no distance filter).
  IF _origin.user_id IS NOT NULL THEN
    _anchor_lat := _origin.latitude; _anchor_lng := _origin.longitude; _anchor_basis := 'device';
  ELSIF _city_lat IS NOT NULL THEN
    _anchor_lat := _city_lat; _anchor_lng := _city_lng; _anchor_basis := 'city';
  END IF;

  RETURN QUERY
  WITH raw_candidates AS (
    SELECT
      p.id, p.name,
      date_part('year', age(p.dob))::integer AS age,
      p.city, p.bio, p.work, p.education, p.interests, p.intents, p.languages, p.lifestyle, p.prompt,
      public.public_photos(p.id, p.photos) AS photos,
      coalesce(st.share_distance, true) AS share,
      -- Device position (hidden-distance members are coarsened to ~11 km), else the city centre.
      CASE WHEN loc.user_id IS NOT NULL THEN
             CASE WHEN coalesce(st.share_distance, true) THEN loc.latitude
                  ELSE round(loc.latitude::numeric, 1)::double precision END
           ELSE cc.latitude END AS pos_lat,
      CASE WHEN loc.user_id IS NOT NULL THEN
             CASE WHEN coalesce(st.share_distance, true) THEN loc.longitude
                  ELSE round(loc.longitude::numeric, 1)::double precision END
           ELSE cc.longitude END AS pos_lng,
      CASE WHEN loc.user_id IS NOT NULL THEN 'device'
           WHEN cc.name_key IS NOT NULL THEN 'city' END AS pos_basis
    FROM public.profiles p
    LEFT JOIN public.discovery_locations loc
      ON loc.user_id = p.user_id AND loc.updated_at >= now() - interval '72 hours'
    LEFT JOIN public.discovery_location_settings st ON st.user_id = p.user_id
    LEFT JOIN public.city_centroids cc ON cc.name_key = public.normalize_city_key(p.city)
    WHERE p.id <> _uid::text
      AND p.status = 'active'
      AND p.onboarded
      AND NOT p.is_demo
      AND NOT public.is_blocked_pair(_uid::text, p.id)
      AND (
        _anchor_basis IS NULL
        OR coalesce(loc.latitude, cc.latitude) BETWEEN
             _anchor_lat - (_radius_km::double precision / 110.574) - 0.06
             AND _anchor_lat + (_radius_km::double precision / 110.574) + 0.06
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.swipes s WHERE s.from_id = _uid::text AND s.to_id = p.id
      )
      AND (_me.seeking = '' OR p.gender = '' OR p.gender = _me.seeking)
      AND p.dob IS NOT NULL
      AND date_part('year', age(p.dob))::integer BETWEEN _age_min AND _age_max
      AND (coalesce(cardinality(_intents), 0) = 0 OR p.intents && _intents)
      AND (coalesce(cardinality(_interests), 0) = 0 OR p.interests && _interests)
      AND (coalesce(cardinality(_languages), 0) = 0 OR p.languages && _languages)
  ), scored AS (
    SELECT
      c.*,
      CASE
        WHEN _anchor_basis IS NOT NULL AND c.pos_lat IS NOT NULL THEN
          public.distance_bucket_km(public.haversine_km(_anchor_lat, _anchor_lng, c.pos_lat, c.pos_lng))
        ELSE NULL
      END AS bucket_km
    FROM raw_candidates c
  ), ranked AS (
    -- Radius filter, ordering and paging all use the bucketed distance (never exact metres). Nearest first,
    -- so a sparse neighbourhood naturally continues into neighbouring and farther cities up to the radius.
    SELECT s.*, coalesce(s.bucket_km, 0) * 1000 AS order_distance_m
    FROM scored s
    WHERE (_anchor_basis IS NULL OR (s.bucket_km IS NOT NULL AND s.bucket_km <= _radius_km))
      AND (_min_radius_km = 0 OR s.bucket_km > _min_radius_km)
  )
  SELECT
    r.id, r.name, r.age, r.city, r.bio, r.work, r.education, r.interests, r.intents,
    r.languages, r.lifestyle, r.prompt, r.photos,
    CASE WHEN r.share THEN r.bucket_km END,
    r.order_distance_m,
    CASE WHEN r.bucket_km IS NULL THEN NULL
         WHEN _anchor_basis = 'device' AND r.pos_basis = 'device' THEN 'device'
         ELSE 'city' END
  FROM ranked r
  WHERE _after_distance_m IS NULL OR (r.order_distance_m, r.id) > (_after_distance_m, _after_id)
  ORDER BY r.order_distance_m, r.id
  LIMIT _limit;
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_discovery_feed_page(
  integer, integer, integer, integer, text[], text[], text[], integer, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discovery_feed_page(
  integer, integer, integer, integer, text[], text[], text[], integer, text, integer) TO authenticated;

COMMIT;
