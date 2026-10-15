-- Private, consent-based location storage and server-filtered stable discovery pages.

CREATE TABLE public.discovery_locations (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX discovery_locations_coordinates_idx
  ON public.discovery_locations (latitude, longitude, updated_at);

ALTER TABLE public.discovery_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discovery_locations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.discovery_locations TO service_role;

CREATE OR REPLACE FUNCTION public.set_my_discovery_location(_latitude double precision, _longitude double precision)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _uid uuid := auth.uid();
  _updated timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _latitude IS NULL OR _longitude IS NULL
     OR _latitude NOT BETWEEN -90 AND 90
     OR _longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _uid::text AND user_id = _uid AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active profile required';
  END IF;

  INSERT INTO public.discovery_locations (user_id, latitude, longitude, updated_at)
  VALUES (_uid, _latitude, _longitude, now())
  ON CONFLICT (user_id) DO UPDATE
    SET latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        updated_at = now()
  RETURNING updated_at INTO _updated;
  RETURN _updated;
END
$$;

CREATE OR REPLACE FUNCTION public.clear_my_discovery_location()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM public.discovery_locations WHERE user_id = auth.uid();
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.has_my_discovery_location()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.discovery_locations
    WHERE user_id = auth.uid() AND updated_at >= now() - interval '72 hours'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_discovery_location(double precision, double precision) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.clear_my_discovery_location() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_my_discovery_location() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_discovery_location(double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_my_discovery_location() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_my_discovery_location() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_discovery_feed_page(
  _limit integer DEFAULT 20,
  _age_min integer DEFAULT 18,
  _age_max integer DEFAULT 99,
  _radius_km integer DEFAULT 50,
  _intents text[] DEFAULT '{}',
  _interests text[] DEFAULT '{}',
  _languages text[] DEFAULT '{}',
  _after_distance_m integer DEFAULT NULL,
  _after_id text DEFAULT NULL
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
  cursor_distance_m integer
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
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _limit IS NULL OR _limit < 1 OR _limit > 50
     OR _age_min IS NULL OR _age_max IS NULL OR _age_min < 18 OR _age_max > 99 OR _age_min > _age_max
     OR _radius_km IS NULL OR _radius_km < 1 OR _radius_km > 500
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

  RETURN QUERY
  WITH raw_candidates AS (
    SELECT
      p.id,
      p.name,
      date_part('year', age(p.dob))::integer AS age,
      p.city,
      p.bio,
      p.work,
      p.education,
      p.interests,
      p.intents,
      p.languages,
      p.lifestyle,
      p.prompt,
      public.public_photos(p.id, p.photos) AS photos,
      CASE
        WHEN _origin.user_id IS NOT NULL AND loc.user_id IS NOT NULL THEN
          6371000.0 * acos(least(1.0, greatest(-1.0,
            sin(radians(_origin.latitude)) * sin(radians(loc.latitude))
            + cos(radians(_origin.latitude)) * cos(radians(loc.latitude))
            * cos(radians(loc.longitude - _origin.longitude))
          )))
        ELSE NULL
      END AS exact_distance_m
    FROM public.profiles p
    LEFT JOIN public.discovery_locations loc
      ON loc.user_id = p.user_id AND loc.updated_at >= now() - interval '72 hours'
    WHERE p.id <> _uid::text
      AND p.status = 'active'
      AND p.onboarded
      AND NOT p.is_demo
      AND NOT public.is_blocked_pair(_uid::text, p.id)
      AND (
        _origin.user_id IS NULL
        OR loc.latitude BETWEEN
          _origin.latitude - (_radius_km::double precision / 110.574)
          AND _origin.latitude + (_radius_km::double precision / 110.574)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.swipes s WHERE s.from_id = _uid::text AND s.to_id = p.id
      )
      AND (_me.seeking = '' OR p.gender = '' OR p.gender = _me.seeking)
      AND (
        _origin.user_id IS NOT NULL
        OR _me.city = ''
        OR p.city = ''
        OR lower(p.city) = lower(_me.city)
      )
      AND p.dob IS NOT NULL
      AND date_part('year', age(p.dob))::integer BETWEEN _age_min AND _age_max
      AND (coalesce(cardinality(_intents), 0) = 0 OR p.intents && _intents)
      AND (coalesce(cardinality(_interests), 0) = 0 OR p.interests && _interests)
      AND (coalesce(cardinality(_languages), 0) = 0 OR p.languages && _languages)
  ), ranked AS (
    SELECT
      c.*,
      CASE
        WHEN c.exact_distance_m IS NOT NULL THEN round(c.exact_distance_m)::integer
        ELSE 0
      END AS order_distance_m
    FROM raw_candidates c
    WHERE
      CASE
        WHEN _origin.user_id IS NOT NULL THEN
          c.exact_distance_m IS NOT NULL AND c.exact_distance_m <= _radius_km * 1000
        ELSE true
      END
  )
  SELECT
    r.id, r.name, r.age, r.city, r.bio, r.work, r.education, r.interests, r.intents,
    r.languages, r.lifestyle, r.prompt, r.photos,
    CASE WHEN r.exact_distance_m IS NULL THEN NULL ELSE ceil(r.exact_distance_m / 1000.0)::integer END,
    r.order_distance_m
  FROM ranked r
  WHERE _after_distance_m IS NULL OR (r.order_distance_m, r.id) > (_after_distance_m, _after_id)
  ORDER BY r.order_distance_m, r.id
  LIMIT _limit;
END
$$;

REVOKE EXECUTE ON FUNCTION public.get_discovery_feed_page(integer, integer, integer, integer, text[], text[], text[], integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discovery_feed_page(integer, integer, integer, integer, text[], text[], text[], integer, text) TO authenticated;
