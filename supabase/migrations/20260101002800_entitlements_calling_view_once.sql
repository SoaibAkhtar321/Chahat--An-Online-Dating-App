-- 20260101002800_entitlements_calling_view_once.sql
-- Tier-aware read receipts, View Once media, progressive-radius discovery and new Google Play product ids.
-- Built on the latest hardened definitions: uniform like quota (001200), coin-billed calls (002400/002700),
-- bucketed location privacy (002600) and Google Play hardening (002100). Does not touch calling functions.

-- ---------- 1. App Settings ----------
-- Like quota and call billing are NOT changed here: likes use the uniform quota (20260101001200),
-- calls use coin billing (20260101002400). Only the view-once retention setting is added.
INSERT INTO public.app_settings (key, value) VALUES
  ('view_once_retention_days', '14'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Helper to safely read int app settings with fallback and bounds
DROP FUNCTION IF EXISTS public.setting_int(text, integer);
CREATE OR REPLACE FUNCTION public.setting_int(_key text, _default integer, _min integer DEFAULT NULL, _max integer DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN _val IS NULL THEN _default
    WHEN _min IS NOT NULL AND _val < _min THEN _min
    WHEN _max IS NOT NULL AND _val > _max THEN _max
    ELSE _val
  END
  FROM (
    SELECT CASE
      WHEN jsonb_typeof(value) = 'number' THEN (value#>>'{}')::integer
      ELSE _default
    END AS _val
    FROM public.app_settings WHERE key = _key
  ) sub;
$$;

-- ---------- 2. record_swipe: uniform quota, ordered idempotent match insert, `match` + `is_match` ----------
CREATE OR REPLACE FUNCTION public.record_swipe(_to_id text, _kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _from_id text := auth.uid()::text;
  _today date := (timezone('Asia/Kolkata', now()))::date;
  _like_limit int := public.setting_int('daily_like_limit', 20);
  _prio_limit int := public.setting_int('daily_priority_like_limit', 3);
  _likes int; _prio int;
  _me public.profiles; _them public.profiles;
  _existing text; _match_id uuid; _is_match boolean := false;
BEGIN
  IF _from_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _to_id IS NULL OR _from_id = _to_id THEN RAISE EXCEPTION 'Cannot swipe on own profile'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('like','pass','priority') THEN RAISE EXCEPTION 'Invalid swipe kind'; END IF;

  -- Serialise swipes between the same pair so two simultaneous likes always produce a match.
  PERFORM pg_advisory_xact_lock(hashtextextended(least(_from_id,_to_id) || '|' || greatest(_from_id,_to_id), 0));

  SELECT * INTO _me FROM public.profiles WHERE id = _from_id;
  IF _me.id IS NULL OR _me.status <> 'active' THEN RAISE EXCEPTION 'Account not active'; END IF;
  SELECT * INTO _them FROM public.profiles WHERE id = _to_id;
  IF _them.id IS NULL OR _them.status <> 'active' OR public.is_blocked_pair(_from_id, _to_id)
     OR (_me.seeking <> '' AND _them.gender <> '' AND _them.gender <> _me.seeking) THEN
    RAISE EXCEPTION 'Profile not available';
  END IF;

  SELECT kind INTO _existing FROM public.swipes WHERE from_id = _from_id AND to_id = _to_id;

  -- Quota applies only when this swipe newly spends a like / priority like.
  IF _kind IN ('like','priority') AND _existing IS DISTINCT FROM _kind THEN
    INSERT INTO public.user_daily_quotas (user_id, ist_date) VALUES (_from_id, _today)
      ON CONFLICT (user_id, ist_date) DO NOTHING;
    SELECT likes_used, super_likes_used INTO _likes, _prio FROM public.user_daily_quotas
      WHERE user_id = _from_id AND ist_date = _today FOR UPDATE;

    IF _kind = 'like' AND _likes >= _like_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'daily_like_limit_reached',
        'likes_remaining', 0, 'reset_at_ist', _today + 1);
    END IF;

    IF _kind = 'priority' AND _prio >= _prio_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'daily_super_like_limit_reached',
        'super_likes_remaining', 0,
        'likes_remaining', greatest(0, _like_limit - _likes),
        'reset_at_ist', _today + 1);
    END IF;

    UPDATE public.user_daily_quotas
      SET likes_used = likes_used + (CASE WHEN _kind = 'like' THEN 1 ELSE 0 END),
          super_likes_used = super_likes_used + (CASE WHEN _kind = 'priority' THEN 1 ELSE 0 END),
          updated_at = now()
      WHERE user_id = _from_id AND ist_date = _today
      RETURNING likes_used, super_likes_used INTO _likes, _prio;
  ELSE
    SELECT likes_used, super_likes_used INTO _likes, _prio FROM public.user_daily_quotas
      WHERE user_id = _from_id AND ist_date = _today;
    _likes := coalesce(_likes, 0); _prio := coalesce(_prio, 0);
  END IF;

  INSERT INTO public.swipes (from_id, to_id, kind) VALUES (_from_id, _to_id, _kind)
    ON CONFLICT (from_id, to_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = now();

  IF _kind <> 'pass' AND (
       EXISTS (SELECT 1 FROM public.swipes WHERE from_id = _to_id AND to_id = _from_id AND kind <> 'pass')
       OR (_them.is_demo AND _them.likes_you)) THEN
    INSERT INTO public.matches (user_a, user_b) VALUES (least(_from_id,_to_id), greatest(_from_id,_to_id))
      ON CONFLICT (user_a, user_b) DO NOTHING;
    SELECT id INTO _match_id FROM public.matches
      WHERE user_a = least(_from_id,_to_id) AND user_b = greatest(_from_id,_to_id);
    _is_match := true;
  END IF;

  RETURN jsonb_build_object('success', true, 'match', _is_match, 'is_match', _is_match, 'match_id', _match_id,
    'likes_remaining', greatest(0, _like_limit - _likes),
    'super_likes_remaining', greatest(0, _prio_limit - _prio));
END $$;

REVOKE EXECUTE ON FUNCTION public.record_swipe(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_swipe(text, text) TO authenticated, service_role;

-- ---------- 3. View Once Media Support in Messages ----------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_view_once boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS viewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS messages_view_once_idx
  ON public.messages (match_id, is_view_once, viewed_at);

-- RPC to atomically open and consume a View Once message
CREATE OR REPLACE FUNCTION public.open_view_once_message(_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _msg public.messages;
  _match public.matches;
  _is_recipient boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _message_id IS NULL THEN RAISE EXCEPTION 'Message ID required'; END IF;

  SELECT * INTO _msg FROM public.messages WHERE id = _message_id FOR UPDATE;
  IF _msg.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'message_not_found');
  END IF;

  SELECT * INTO _match FROM public.matches WHERE id = _msg.match_id;
  IF _match.id IS NULL OR _uid::text NOT IN (_match.user_a, _match.user_b) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  _is_recipient := (_uid::text <> _msg.sender);

  -- Not a view once message: standard access
  IF NOT _msg.is_view_once THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_view_once', false,
      'image_path', _msg.image_path
    );
  END IF;

  -- Sender cannot consume their own view-once image as recipient
  IF NOT _is_recipient THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_view_once', true,
      'is_sender', true,
      'viewed_at', _msg.viewed_at
    );
  END IF;

  -- Already viewed check
  IF _msg.viewed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_viewed',
      'message', 'This photo has already been viewed.',
      'viewed_at', _msg.viewed_at
    );
  END IF;

  -- Expiry check
  IF _msg.expires_at IS NOT NULL AND _msg.expires_at < now() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'expired',
      'message', 'This photo has expired.'
    );
  END IF;

  -- Atomically consume
  UPDATE public.messages
  SET viewed_at = now(),
      viewed_by = _uid
  WHERE id = _msg.id;

  RETURN jsonb_build_object(
    'success', true,
    'is_view_once', true,
    'image_path', _msg.image_path,
    'viewed_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.open_view_once_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_view_once_message(uuid) TO authenticated, service_role;


-- get_match_messages: 20260101002500 behaviour (ascending order, read receipts for recipient, sender sees them
-- only on Plus/VIP) + View Once metadata and an optional newest-N limit.
CREATE OR REPLACE FUNCTION public.get_match_messages(_match_id uuid, _limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  match_id uuid,
  sender text,
  body text,
  image_path text,
  audio_path text,
  audio_duration_sec integer,
  message_type text,
  is_view_once boolean,
  viewed_at timestamptz,
  created_at timestamptz,
  read_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _my_id text := auth.uid()::text;
  _tier text;
BEGIN
  IF _my_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.is_match_member(_match_id) THEN RAISE EXCEPTION 'Not a member of this match'; END IF;

  _tier := public.get_active_subscription_tier(_my_id);

  RETURN QUERY
  SELECT * FROM (
    SELECT
      m.id,
      m.match_id,
      m.sender,
      m.body,
      -- A consumed View Once image is never returned to the recipient.
      CASE
        WHEN m.is_view_once AND m.viewed_at IS NOT NULL AND m.sender <> _my_id THEN NULL
        ELSE m.image_path
      END AS image_path,
      m.audio_path,
      m.audio_duration_sec,
      m.message_type,
      m.is_view_once,
      m.viewed_at,
      m.created_at,
      CASE
        WHEN m.sender = _my_id AND _tier NOT IN ('plus', 'vip') THEN NULL
        ELSE m.read_at
      END AS read_at
    FROM public.messages m
    WHERE m.match_id = _match_id
    ORDER BY m.created_at DESC
    LIMIT greatest(1, least(coalesce(_limit, 50), 100))
  ) latest
  ORDER BY latest.created_at ASC;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_match_messages(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_messages(uuid, integer) TO authenticated, service_role;

-- ---------- 4. Location discovery with progressive radius expansion (keeps 002600 privacy bucketing) ----------
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
      -- Progressive expansion: later pages return only the band beyond the previous radius (bucketed km).
      AND (_min_radius_km = 0 OR s.bucket_km > _min_radius_km)
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

REVOKE EXECUTE ON FUNCTION public.get_discovery_feed_page(integer, integer, integer, integer, text[], text[], text[], integer, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discovery_feed_page(integer, integer, integer, integer, text[], text[], text[], integer, text, integer) TO authenticated;

-- ---------- 5. Google Play product mapping for the new packages (keeps 002100 hardening) ----------
CREATE OR REPLACE FUNCTION public.record_verified_google_purchase(
  _user_id text,
  _product_id text,
  _token_hash text,
  _order_id text,
  _starts_at timestamptz,
  _expires_at timestamptz,
  _auto_renew boolean,
  _provider_state text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid;
  _tier text;
  _months integer;
  _order public.subscription_orders;
  _subscription public.user_subscriptions;
  _entitlement_updated boolean := false;
  _was_replay boolean := false;
  _tier_rank integer;
  _current_tier_rank integer;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'User ID required'; END IF;
  _uid := _user_id::uuid;
  IF _product_id IS NULL THEN RAISE EXCEPTION 'Product ID required'; END IF;
  -- Catalog: new packages (149/7d, 299/15d, 499/1m) and the existing products
  IF _product_id IN ('chahat_pkg_149_7d', 'chahat_premium_1m') THEN _tier := 'premium'; _months := 1;
  ELSIF _product_id = 'chahat_premium_3m' THEN _tier := 'premium'; _months := 3;
  ELSIF _product_id = 'chahat_premium_6m' THEN _tier := 'premium'; _months := 6;
  ELSIF _product_id = 'chahat_premium_12m' THEN _tier := 'premium'; _months := 12;
  ELSIF _product_id IN ('chahat_pkg_299_15d', 'chahat_plus_1m') THEN _tier := 'plus'; _months := 1;
  ELSIF _product_id IN ('chahat_pkg_499_1m', 'chahat_vip_1m') THEN _tier := 'vip'; _months := 1;
  ELSE RAISE EXCEPTION 'Unsupported Google Play product'; END IF;
  _tier_rank := CASE _tier WHEN 'premium' THEN 1 WHEN 'plus' THEN 2 WHEN 'vip' THEN 3 END;

  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid purchase token hash';
  END IF;
  IF _starts_at IS NULL OR _expires_at IS NULL OR _starts_at > now() + interval '5 minutes'
     OR _expires_at <= now() OR _expires_at <= _starts_at THEN
    RAISE EXCEPTION 'Purchase is not currently entitled';
  END IF;
  IF _provider_state IS NULL OR _provider_state NOT IN ('ACTIVE', 'IN_GRACE_PERIOD', 'CANCELED') THEN
    RAISE EXCEPTION 'Purchase state is not entitled';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('google_play|' || _token_hash, 0));
  SELECT * INTO _order FROM public.subscription_orders
  WHERE store = 'google_play' AND token_hash = _token_hash
  FOR UPDATE;

  IF FOUND THEN
    _was_replay := true;
    IF _order.user_id IS DISTINCT FROM _uid THEN
      RAISE EXCEPTION 'Purchase token is already associated with another account';
    END IF;
    IF _order.product_id IS DISTINCT FROM _product_id THEN
      RAISE EXCEPTION 'Purchase token product does not match';
    END IF;
    IF _starts_at < _order.starts_at OR _expires_at < _order.expires_at THEN
      RAISE EXCEPTION 'Stale purchase update rejected';
    END IF;
    UPDATE public.subscription_orders
      SET order_id = coalesce(_order_id, order_id),
          expires_at = greatest(expires_at, _expires_at),
          provider_state = _provider_state,
          auto_renew = coalesce(_auto_renew, false),
          verified_at = now()
      WHERE id = _order.id
      RETURNING * INTO _order;
  ELSE
    INSERT INTO public.subscription_orders (
      user_id, store, order_id, product_id, token_hash, tier, amount_inr,
      starts_at, expires_at, provider_state, auto_renew, verified_at
    ) VALUES (
      _uid, 'google_play', _order_id, _product_id, _token_hash, _tier, 0,
      _starts_at, _expires_at, _provider_state, coalesce(_auto_renew, false), now()
    ) RETURNING * INTO _order;
  END IF;

  SELECT * INTO _subscription FROM public.user_subscriptions
  WHERE user_id = _uid::text FOR UPDATE;

  IF FOUND
     AND _subscription.status = 'active'
     AND (_subscription.expires_at IS NULL OR _subscription.expires_at > now()) THEN
    _current_tier_rank := CASE _subscription.tier
      WHEN 'premium' THEN 1
      WHEN 'plus' THEN 2
      WHEN 'vip' THEN 3
      ELSE 0
    END;
    IF _tier_rank < _current_tier_rank THEN
      RAISE EXCEPTION 'Purchase cannot downgrade a newer active subscription';
    END IF;
  END IF;

  IF _subscription.user_id IS NULL THEN
    INSERT INTO public.user_subscriptions (
      user_id, tier, status, starts_at, expires_at, auto_renew, updated_at, source_order_id
    ) VALUES (
      _uid::text, _tier, 'active', _starts_at, _expires_at, coalesce(_auto_renew, false), now(), _order.id
    );
    _entitlement_updated := true;
  ELSIF _subscription.status <> 'active'
     OR (_subscription.expires_at IS NOT NULL AND _subscription.expires_at <= now())
     OR _subscription.source_order_id = _order.id
     OR (_starts_at >= _subscription.starts_at AND _expires_at >= coalesce(_subscription.expires_at, '-infinity'::timestamptz)) THEN
    UPDATE public.user_subscriptions
      SET tier = _tier,
          status = 'active',
          starts_at = _starts_at,
          expires_at = greatest(_expires_at, coalesce(_subscription.expires_at, _expires_at)),
          auto_renew = coalesce(_auto_renew, false),
          updated_at = now(),
          source_order_id = _order.id
      WHERE user_id = _uid::text;
    _entitlement_updated := true;
  END IF;

  SELECT * INTO _subscription FROM public.user_subscriptions WHERE user_id = _uid::text;
  RETURN jsonb_build_object(
    'success', true,
    'idempotent', _was_replay,
    'entitlement_updated', _entitlement_updated,
    'tier', CASE WHEN _subscription.status = 'active'
                      AND (_subscription.expires_at IS NULL OR _subscription.expires_at > now())
                 THEN _subscription.tier ELSE 'free' END,
    'expires_at', _subscription.expires_at,
    'order_id', _order.id
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.record_verified_google_purchase(text, text, text, text, timestamptz, timestamptz, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_google_purchase(text, text, text, text, timestamptz, timestamptz, boolean, text) TO service_role;