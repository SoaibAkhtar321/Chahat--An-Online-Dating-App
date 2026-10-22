-- 20260101005100_paid_plans_unlimited_likes.sql
-- Paid plans (premium / plus / vip) are advertised as "Unlimited Likes", but record_swipe enforced the same daily like
-- limit for everyone. This forward-only migration delivers the promise while the free plan keeps its limit:
--   * record_swipe: a member with an ACTIVE paid entitlement is never stopped by daily_like_limit (priority likes keep
--     their own separate daily cap). likes_remaining is reported as -1 with unlimited = true for them.
--   * get_daily_like_quota: reports unlimited for paid members (the app already understands daily_limit < 0).
-- Entitlement is read with get_active_subscription_tier(), which only returns a paid tier while the verified
-- subscription is active and unexpired, so expiry/refund puts the limit straight back.
CREATE OR REPLACE FUNCTION public.record_swipe(_to_id text, _kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _from_id text := auth.uid()::text;
  _today date := (timezone('Asia/Kolkata', now()))::date;
  _like_limit int := public.setting_int('daily_like_limit', 50);
  _prio_limit int := public.setting_int('daily_priority_like_limit', 3);
  _likes int; _prio int;
  _paid boolean := false;
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

  _paid := public.get_active_subscription_tier(_from_id) IN ('premium', 'plus', 'vip');

  SELECT kind INTO _existing FROM public.swipes WHERE from_id = _from_id AND to_id = _to_id;

  -- Quota applies only when this swipe newly spends a like / priority like.
  IF _kind IN ('like','priority') AND _existing IS DISTINCT FROM _kind THEN
    INSERT INTO public.user_daily_quotas (user_id, ist_date) VALUES (_from_id, _today)
      ON CONFLICT (user_id, ist_date) DO NOTHING;
    SELECT likes_used, super_likes_used INTO _likes, _prio FROM public.user_daily_quotas
      WHERE user_id = _from_id AND ist_date = _today FOR UPDATE;

    IF _kind = 'like' AND NOT _paid AND _likes >= _like_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'daily_like_limit_reached',
        'likes_remaining', 0, 'reset_at_ist', _today + 1);
    END IF;

    IF _kind = 'priority' AND _prio >= _prio_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'daily_super_like_limit_reached',
        'super_likes_remaining', 0,
        'likes_remaining', CASE WHEN _paid THEN -1 ELSE greatest(0, _like_limit - _likes) END,
        'unlimited', _paid,
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
    'likes_remaining', CASE WHEN _paid THEN -1 ELSE greatest(0, _like_limit - _likes) END,
    'unlimited', _paid,
    'super_likes_remaining', greatest(0, _prio_limit - _prio));
END $$;

REVOKE EXECUTE ON FUNCTION public.record_swipe(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_swipe(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_daily_like_quota()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
  _today date := (timezone('Asia/Kolkata', now()))::date;
  _limit integer := public.setting_int('daily_like_limit', 50);
  _used integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.get_active_subscription_tier(_uid) IN ('premium', 'plus', 'vip') THEN
    RETURN jsonb_build_object(
      'daily_limit', -1,
      'likes_remaining', -1,
      'unlimited', true,
      'reset_at_ist', _today + 1
    );
  END IF;

  SELECT likes_used INTO _used
  FROM public.user_daily_quotas
  WHERE user_id = _uid AND ist_date = _today;

  RETURN jsonb_build_object(
    'daily_limit', greatest(0, _limit),
    'likes_remaining', greatest(0, _limit - coalesce(_used, 0)),
    'reset_at_ist', _today + 1
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_daily_like_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_like_quota() TO authenticated, service_role;
