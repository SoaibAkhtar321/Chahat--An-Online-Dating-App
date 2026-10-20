-- 20260101004400_discovery_feed_block_antijoin.sql
-- Performance: get_discovery_feed_page() called public.is_blocked_pair() once per candidate member, before the
-- distance filter and LIMIT. That SECURITY DEFINER SQL function cannot be inlined, so one 20-row page executed
-- it ~50,000 times on a 100,000-member table (~600 ms). The block check is now a set-based NOT EXISTS on
-- public.blocks (primary key (blocker, blocked)), which keeps the same meaning: a block in EITHER direction
-- between the caller and the candidate hides the candidate.
-- Only that one predicate changes. Signature, return type, grants and every other rule are identical to
-- 20260101004300, which is not edited. Nothing here exposes coordinates or weakens authorization.
BEGIN;

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
      -- Set-based block check (either direction). is_blocked_pair() is a SECURITY DEFINER SQL function that
      -- Postgres cannot inline, so it ran once per candidate before the distance filter and LIMIT. This feed
      -- is itself SECURITY DEFINER and _uid is the authenticated caller, so the auth.uid() clause inside
      -- is_blocked_pair() is redundant here and the semantics are identical.
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE (b.blocker = _uid::text AND b.blocked = p.id)
           OR (b.blocker = p.id AND b.blocked = _uid::text)
      )
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
