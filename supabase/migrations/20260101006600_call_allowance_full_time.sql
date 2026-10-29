-- 20260101006600_call_allowance_full_time.sql
-- Video-call daily allowance fixes. Forward-only; no table, policy or RPC signature changes.
--
-- 1. Calls no longer lose seconds while the phones are still connecting. The allowance clock started the
--    moment the second participant was given a media token, before Agora had joined and video was showing,
--    so a "30 second" call gave noticeably less talk time. The clock now starts when BOTH phones report
--    connected, or at the latest 10 s after both tokens were issued (anti-bypass bound from 20260101005800,
--    so a modified client that never reports "connected" still pays from then).
-- 2. create_video_call refuses a new call when the caller has no allowance left today
--    (error 'daily_call_allowance_used'), so nobody's phone rings for a call that could never be answered.
--    Free callers who hold enough coins for one minute keep the existing coin path.
-- Usage is still the sum of real call time today (IST), so 15 s + 15 s and 30 s in one go both work.
BEGIN;

UPDATE public.app_settings SET value = '10'::jsonb WHERE key = 'call_join_slack_seconds';
INSERT INTO public.app_settings (key, value) VALUES ('call_join_slack_seconds', '10'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_video_call(_match_id uuid, _call_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _caller text;
  _recipient text;
  _caller_profile public.profiles;
  _recipient_profile public.profiles;
  _call_id uuid;
  _now timestamptz := now();
  _lock_user text;
  _tier text;
  _limit integer;
  _left integer;
  _coins bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _call_type NOT IN ('audio', 'video') THEN RAISE EXCEPTION 'Unsupported call type'; END IF;

  SELECT user_a, user_b INTO _caller, _recipient
  FROM public.matches
  WHERE id = _match_id AND _uid::text IN (user_a, user_b)
    AND NOT public.is_blocked_pair(user_a, user_b);
  IF _caller IS NULL THEN RAISE EXCEPTION 'Active unblocked match required'; END IF;
  IF _caller <> _uid::text THEN
    _recipient := _caller;
    _caller := _uid::text;
  ELSE
    _recipient := CASE WHEN _uid::text = (SELECT user_a FROM public.matches WHERE id = _match_id)
      THEN (SELECT user_b FROM public.matches WHERE id = _match_id)
      ELSE (SELECT user_a FROM public.matches WHERE id = _match_id) END;
  END IF;

  SELECT * INTO _caller_profile FROM public.profiles WHERE id = _caller AND status = 'active' AND onboarded AND NOT is_demo;
  SELECT * INTO _recipient_profile FROM public.profiles WHERE id = _recipient AND status = 'active' AND onboarded AND NOT is_demo;
  IF _caller_profile.id IS NULL OR _recipient_profile.id IS NULL
     OR public.is_blocked_pair(_caller, _recipient) THEN
    RAISE EXCEPTION 'Participants are not eligible to call';
  END IF;

  FOREACH _lock_user IN ARRAY ARRAY[least(_caller, _recipient), greatest(_caller, _recipient)] LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(_lock_user, 211));
  END LOOP;

  -- Close anything abandoned for these two users first, so stale rows can neither block a new
  -- invitation (one-pending-per-match index) nor count as an active call.
  PERFORM public.expire_video_calls(200, ARRAY[_uid, _recipient::uuid]);

  -- Abuse protection: bounded volume of UNANSWERED invitations per caller and per match (calls that
  -- were accepted never count, so real conversations are not throttled).
  IF (SELECT count(*) FROM public.video_calls c
      WHERE c.caller_id = _uid AND c.accepted_at IS NULL AND c.created_at > _now - interval '10 minutes')
     >= public.billing_setting_int('call_create_limit_per_10min', 6, 1, 1000) THEN
    RAISE EXCEPTION 'Too many call attempts';
  END IF;
  IF (SELECT count(*) FROM public.video_calls c
      WHERE c.caller_id = _uid AND c.match_id = _match_id AND c.accepted_at IS NULL
        AND c.created_at > _now - interval '10 minutes')
     >= public.billing_setting_int('call_create_limit_per_match_10min', 3, 1, 1000) THEN
    RAISE EXCEPTION 'Too many call attempts';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.video_calls c
    WHERE (c.status = 'accepted' OR (c.status = 'pending' AND c.expires_at > _now))
      AND (_uid IN (c.caller_id, c.recipient_id))
  ) THEN
    RAISE EXCEPTION 'A participant already has an active call';
  END IF;

  -- Daily allowance (IST day). The caller pays for a call, so a caller with no time left today cannot ring
  -- anyone: the recipient's phone would ring for a call that could never be answered. A free caller who
  -- still holds coins for one minute keeps the existing pay-per-minute path in transition_video_call.
  IF public.billing_setting_int('call_daily_allowance_enabled', 1, 0, 1) = 1 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('call_allowance|' || _uid::text, 0));
    _tier := public.get_active_subscription_tier(_uid::text);
    _limit := CASE WHEN _tier IN ('premium', 'plus', 'vip')
                   THEN public.billing_setting_int('call_premium_daily_seconds', 300, 0, 86400)
                   ELSE public.billing_setting_int('call_free_daily_seconds', 30, 0, 86400) END;
    _left := greatest(0, _limit - public.call_allowance_used_today(_uid));
    IF _left <= 0 THEN
      _coins := coalesce((SELECT w.balance FROM public.coin_wallets w WHERE w.user_id = _uid), 0);
      IF _tier IN ('premium', 'plus', 'vip') OR _coins < public.call_rate_per_minute(_call_type) THEN
        RETURN jsonb_build_object(
          'success', false, 'error', 'daily_call_allowance_used',
          'is_free', _tier NOT IN ('premium', 'plus', 'vip'),
          'next_renewal_at', ((timezone('Asia/Kolkata', now())::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO public.video_calls
    (match_id, caller_id, recipient_id, call_type, expires_at)
  VALUES
    (_match_id, _uid, _recipient::uuid, _call_type, _now + interval '60 seconds')
  RETURNING id INTO _call_id;

  RETURN jsonb_build_object(
    'success', true, 'call_id', _call_id, 'match_id', _match_id,
    'call_type', _call_type, 'status', 'pending',
    'free_call_until', NULL
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.create_video_call(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_video_call(uuid, text) TO authenticated;

COMMIT;
