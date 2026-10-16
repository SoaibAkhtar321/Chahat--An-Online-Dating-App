-- Location privacy hardening on top of 20260101001900_location_discovery.sql.
--
--  * Stored coordinates are snapped to a ~1.1 km grid (2 decimals); the precise value is never stored.
--    Existing rows are snapped in place.
--  * Other members only ever receive a coarse, bucketed distance. The radius filter and the paging cursor use
--    the bucketed value too, so neither can be used to recover finer distances. The cursor no longer exposes
--    exact metres.
--  * Members can hide their distance. Hidden members are positioned at ~11 km granularity for other people's
--    radius filters, so a radius sweep cannot pinpoint them.
--  * set_my_discovery_location gains an accuracy cap, an update rate limit and an implausible-movement guard.
--    NOTE: a client-supplied location is not proof of presence; these guards only raise the cost of crude spoofing.
--  * get_distance_to(profile) for the profile screen; get_my_location_status() for settings.
--  * Location data is removed when a profile is purged (trigger) and when the auth user is deleted (FK cascade).
-- Existing function names, the get_discovery_feed_page signature and its result columns are unchanged.

-- 1. Per-user preference + rate-limit state (survives "remove my location") ---------------------------------------
CREATE TABLE public.discovery_location_settings (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  share_distance    boolean NOT NULL DEFAULT true,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  updates_in_window integer NOT NULL DEFAULT 0 CHECK (updates_in_window >= 0)
);
ALTER TABLE public.discovery_location_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discovery_location_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.discovery_location_settings TO service_role;

-- 2. Data minimisation of existing rows -------------------------------------------------------------------------
UPDATE public.discovery_locations
   SET latitude = round(latitude::numeric, 2)::double precision,
       longitude = round(longitude::numeric, 2)::double precision
 WHERE latitude <> round(latitude::numeric, 2)::double precision
    OR longitude <> round(longitude::numeric, 2)::double precision;

-- 3. Internal helpers (not callable by clients) ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haversine_km(_lat1 double precision, _lng1 double precision,
                                                _lat2 double precision, _lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371.0088 * asin(least(1.0, sqrt(
    power(sin(radians(_lat2 - _lat1) / 2), 2) +
    cos(radians(_lat1)) * cos(radians(_lat2)) * power(sin(radians(_lng2 - _lng1) / 2), 2))))
$$;

-- Coarse, user-facing distance. Rounds UP so a radius filter never includes someone farther than the radius:
-- <=2 -> 2, <=10 -> ceil, otherwise next multiple of 5.
CREATE OR REPLACE FUNCTION public.distance_bucket_km(_d double precision)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN _d IS NULL THEN NULL
              WHEN _d <= 2 THEN 2
              WHEN _d <= 10 THEN ceil(_d)::integer
              ELSE (ceil(_d / 5.0) * 5)::integer END
$$;

REVOKE EXECUTE ON FUNCTION public.haversine_km(double precision, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.distance_bucket_km(double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.haversine_km(double precision, double precision, double precision, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.distance_bucket_km(double precision) TO service_role;

-- 4. set_my_discovery_location: snapped, validated, rate-limited ----------------------------------------------------
-- The 2-argument version is replaced (an extra defaulted argument would otherwise make 2-argument calls ambiguous).
DROP FUNCTION IF EXISTS public.set_my_discovery_location(double precision, double precision);

CREATE OR REPLACE FUNCTION public.set_my_discovery_location(
  _latitude double precision, _longitude double precision, _accuracy_m integer DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _slat double precision; _slng double precision;
  _prev public.discovery_locations%ROWTYPE;
  _win_start timestamptz; _win_count integer;
  _dist double precision; _hours double precision;
  _updated timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _latitude IS NULL OR _longitude IS NULL
     OR _latitude = 'NaN'::float8 OR _longitude = 'NaN'::float8
     OR _latitude NOT BETWEEN -90 AND 90
     OR _longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;
  IF _accuracy_m IS NOT NULL AND (_accuracy_m < 0 OR _accuracy_m > 5000) THEN
    RAISE EXCEPTION 'location_too_imprecise';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _uid::text AND user_id = _uid AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active profile required';
  END IF;

  -- Data minimisation: the precise value is discarded here and never stored.
  _slat := round(_latitude::numeric, 2)::double precision;
  _slng := round(_longitude::numeric, 2)::double precision;

  PERFORM pg_advisory_xact_lock(hashtextextended('discovery_loc:' || _uid::text, 0));

  INSERT INTO public.discovery_location_settings (user_id) VALUES (_uid) ON CONFLICT (user_id) DO NOTHING;
  SELECT window_started_at, updates_in_window INTO _win_start, _win_count
    FROM public.discovery_location_settings WHERE user_id = _uid FOR UPDATE;
  IF now() - _win_start > interval '1 hour' THEN _win_start := now(); _win_count := 0; END IF;
  IF _win_count >= 12 THEN RAISE EXCEPTION 'rate_limited'; END IF;

  -- Implausible movement (crude spoofing guard): >100 km at >1000 km/h versus the previous recent fix.
  SELECT * INTO _prev FROM public.discovery_locations WHERE user_id = _uid;
  IF FOUND AND _prev.updated_at > now() - interval '6 hours' THEN
    _dist := public.haversine_km(_prev.latitude, _prev.longitude, _slat, _slng);
    _hours := greatest(extract(epoch FROM (now() - _prev.updated_at)), 60) / 3600.0;
    IF _dist > 100 AND _dist / _hours > 1000 THEN RAISE EXCEPTION 'implausible_movement'; END IF;
  END IF;

  UPDATE public.discovery_location_settings
     SET window_started_at = _win_start, updates_in_window = _win_count + 1
   WHERE user_id = _uid;

  INSERT INTO public.discovery_locations (user_id, latitude, longitude, updated_at)
  VALUES (_uid, _slat, _slng, now())
  ON CONFLICT (user_id) DO UPDATE
    SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, updated_at = now()
  RETURNING updated_at INTO _updated;
  RETURN _updated;
END
$$;

-- 5. Privacy controls and status ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_distance_sharing(_share boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _share IS NULL THEN RAISE EXCEPTION 'Invalid argument'; END IF;
  INSERT INTO public.discovery_location_settings (user_id, share_distance) VALUES (auth.uid(), _share)
  ON CONFLICT (user_id) DO UPDATE SET share_distance = EXCLUDED.share_distance;
  RETURN _share;
END
$$;

CREATE OR REPLACE FUNCTION public.get_my_location_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE jsonb_build_object(
    'has_location', coalesce(l.updated_at >= now() - interval '72 hours', false),
    'stale', coalesce(l.updated_at < now() - interval '72 hours', false),
    'updated_at', l.updated_at,
    'share_distance', coalesce(s.share_distance, true)
  ) END
  FROM (SELECT 1) one
  LEFT JOIN public.discovery_locations l ON l.user_id = auth.uid()
  LEFT JOIN public.discovery_location_settings s ON s.user_id = auth.uid()
$$;

-- 6. Distance to one profile (bucketed; NULL when unknown / hidden / blocked / not discoverable) --------------------
CREATE OR REPLACE FUNCTION public.get_distance_to(_id text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _my text := auth.uid()::text;
  _o public.discovery_locations%ROWTYPE;
  _t public.discovery_locations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _id IS NULL OR _id = _my OR public.is_blocked_pair(_my, _id) THEN RETURN NULL; END IF;

  SELECT * INTO _o FROM public.discovery_locations
   WHERE user_id = auth.uid() AND updated_at >= now() - interval '72 hours';
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT l.* INTO _t
    FROM public.profiles p
    JOIN public.discovery_locations l ON l.user_id = p.user_id AND l.updated_at >= now() - interval '72 hours'
    LEFT JOIN public.discovery_location_settings s ON s.user_id = p.user_id
   WHERE p.id = _id AND p.status = 'active' AND p.onboarded AND NOT p.is_demo
     AND coalesce(s.share_distance, true);
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN public.distance_bucket_km(public.haversine_km(_o.latitude, _o.longitude, _t.latitude, _t.longitude));
END
$$;

-- 7. Account deletion cleanup --------------------------------------------------------------------------------------------
-- purge_user_data (20260101002200) deletes the profile row; the auth user delete cascades via FKs. This trigger makes
-- the profile purge alone remove stored location + preferences, without rewriting purge_user_data.
CREATE OR REPLACE FUNCTION public.cleanup_location_on_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.user_id IS NOT NULL THEN
    DELETE FROM public.discovery_locations WHERE user_id = OLD.user_id;
    DELETE FROM public.discovery_location_settings WHERE user_id = OLD.user_id;
  END IF;
  RETURN OLD;
END
$$;
REVOKE EXECUTE ON FUNCTION public.cleanup_location_on_profile_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_cleanup_location ON public.profiles;
CREATE TRIGGER profiles_cleanup_location
  AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_location_on_profile_delete();

-- 8. Discovery feed: same signature and columns; bucketed distance, radius and cursor ---------------------------------
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
      coalesce(st.share_distance, true) AS share,
      -- Members who hide their distance are positioned at ~11 km granularity for everyone else's radius filter,
      -- so a radius sweep cannot be used to pinpoint them.
      CASE WHEN coalesce(st.share_distance, true) THEN loc.latitude
           ELSE round(loc.latitude::numeric, 1)::double precision END AS pos_lat,
      CASE WHEN coalesce(st.share_distance, true) THEN loc.longitude
           ELSE round(loc.longitude::numeric, 1)::double precision END AS pos_lng,
      loc.user_id AS loc_user
    FROM public.profiles p
    LEFT JOIN public.discovery_locations loc
      ON loc.user_id = p.user_id AND loc.updated_at >= now() - interval '72 hours'
    LEFT JOIN public.discovery_location_settings st ON st.user_id = p.user_id
    WHERE p.id <> _uid::text
      AND p.status = 'active'
      AND p.onboarded
      AND NOT p.is_demo
      AND NOT public.is_blocked_pair(_uid::text, p.id)
      AND (
        _origin.user_id IS NULL
        OR loc.latitude BETWEEN
          _origin.latitude - (_radius_km::double precision / 110.574) - 0.06
          AND _origin.latitude + (_radius_km::double precision / 110.574) + 0.06
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
  ), scored AS (
    SELECT
      c.*,
      CASE
        WHEN _origin.user_id IS NOT NULL AND c.loc_user IS NOT NULL THEN
          public.distance_bucket_km(public.haversine_km(_origin.latitude, _origin.longitude, c.pos_lat, c.pos_lng))
        ELSE NULL
      END AS bucket_km
    FROM raw_candidates c
  ), ranked AS (
    -- Radius filter, ordering and paging all use the bucketed distance (never exact metres).
    SELECT s.*, coalesce(s.bucket_km, 0) * 1000 AS order_distance_m
    FROM scored s
    WHERE
      CASE
        WHEN _origin.user_id IS NOT NULL THEN s.bucket_km IS NOT NULL AND s.bucket_km <= _radius_km
        ELSE true
      END
  )
  SELECT
    r.id, r.name, r.age, r.city, r.bio, r.work, r.education, r.interests, r.intents,
    r.languages, r.lifestyle, r.prompt, r.photos,
    CASE WHEN r.share THEN r.bucket_km END,
    r.order_distance_m
  FROM ranked r
  WHERE _after_distance_m IS NULL OR (r.order_distance_m, r.id) > (_after_distance_m, _after_id)
  ORDER BY r.order_distance_m, r.id
  LIMIT _limit;
END
$$;

-- 9. Grants: client-facing RPCs are authenticated-only ----------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_my_discovery_location(double precision, double precision, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_distance_sharing(boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_location_status() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_distance_to(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_discovery_feed_page(integer, integer, integer, integer, text[], text[], text[], integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_discovery_location(double precision, double precision, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_distance_sharing(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_location_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_distance_to(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_discovery_feed_page(integer, integer, integer, integer, text[], text[], text[], integer, text) TO authenticated;
