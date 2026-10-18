-- 20260101003200_daily_call_allowance.sql
-- Product rule: video calling is a DAILY allowance (resets at midnight IST, like the like quota).
--   Free:    50 likes/day (see 20260101003100) and 15 s of video call per day.
--   Premium: unlimited likes and 5 minutes (300 s) of video call per day.
-- Free callers who have used their 15 s can still continue with coins (as before); premium callers
-- have no coin path, so once their 300 s are used the accept is refused with daily_call_allowance_used.
-- Usage is derived on the server from the caller's accepted calls (billing_free_seconds is the
-- allowance window granted to each call), never from the client.
-- Kill switch: app_settings.call_daily_allowance_enabled = 0 restores the legacy per-call rules
-- (free minute per call, premium unmetered). Forward-only; all other behaviour is unchanged.
INSERT INTO public.app_settings (key, value) VALUES
  ('call_daily_allowance_enabled', '1'::jsonb),
  ('call_free_daily_seconds', '15'::jsonb),
  ('call_premium_daily_seconds', '300'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.call_allowance_used_today(_uid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(greatest(0, least(
           floor(extract(epoch FROM (coalesce(c.ended_at, now()) - c.accepted_at))),
           coalesce(c.billing_free_seconds, 0)))), 0)::integer
  FROM public.video_calls c
  WHERE c.caller_id = _uid
    AND c.accepted_at IS NOT NULL
    AND c.accepted_at >= (timezone('Asia/Kolkata', now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata';
$$;
REVOKE EXECUTE ON FUNCTION public.call_allowance_used_today(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transition_video_call(_call_id uuid, _action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _call public.video_calls;
  _exempt boolean;
  _free_seconds integer;
  _allow integer;
  _left integer;
  _rate integer;
  _charge jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _action NOT IN ('accept', 'decline', 'cancel', 'end') THEN RAISE EXCEPTION 'Invalid call action'; END IF;

  SELECT * INTO _call FROM public.video_calls
  WHERE id = _call_id AND _uid IN (caller_id, recipient_id)
  FOR UPDATE;
  IF _call.id IS NULL THEN RAISE EXCEPTION 'Call not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.profiles caller_profile ON caller_profile.id = _call.caller_id::text
    JOIN public.profiles recipient_profile ON recipient_profile.id = _call.recipient_id::text
    WHERE m.id = _call.match_id
      AND NOT public.is_blocked_pair(m.user_a, m.user_b)
      AND caller_profile.status = 'active' AND caller_profile.onboarded AND NOT caller_profile.is_demo
      AND recipient_profile.status = 'active' AND recipient_profile.onboarded AND NOT recipient_profile.is_demo
  ) THEN
    IF _call.status IN ('pending', 'accepted') THEN
      UPDATE public.video_calls SET status = 'ended', ended_at = now() WHERE id = _call.id;
    END IF;
    RETURN jsonb_build_object('success', false, 'status', 'ended', 'error', 'Participants are no longer eligible');
  END IF;

  IF _call.status = 'pending' AND _call.expires_at <= now() THEN
    UPDATE public.video_calls SET status = 'timed_out', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', false, 'status', 'timed_out');
  END IF;
  IF _call.status = 'accepted' AND _call.free_call_until IS NOT NULL
     AND _call.free_call_until <= now() THEN
    UPDATE public.video_calls SET status = 'ended', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'ended');
  END IF;

  IF _action = 'accept' AND _uid = _call.recipient_id AND _call.status = 'pending' THEN
    -- The caller pays. A paid-tier caller is exempt; everyone else gets a free window and must
    -- then hold coins for each further minute. Rates are snapshotted so a mid-call settings change
    -- cannot alter what an in-flight call costs.
    _exempt := public.get_active_subscription_tier(_call.caller_id::text) <> 'free';
    _free_seconds := public.billing_setting_int('call_free_seconds', 60, 10, 3600);

    IF public.billing_setting_int('call_daily_allowance_enabled', 1, 0, 1) = 1 THEN
      -- Daily allowance (IST day): free callers get call_free_daily_seconds, premium callers get
      -- call_premium_daily_seconds. Usage is derived from the caller's own accepted calls, so it
      -- cannot be forged by a client. Serialised per caller so two accepts cannot both spend it.
      PERFORM pg_advisory_xact_lock(hashtextextended('call_allowance|' || _call.caller_id::text, 0));
      _allow := CASE WHEN _exempt
                     THEN public.billing_setting_int('call_premium_daily_seconds', 300, 0, 86400)
                     ELSE public.billing_setting_int('call_free_daily_seconds', 15, 0, 86400) END;
      _left := greatest(0, _allow - public.call_allowance_used_today(_call.caller_id));
      _rate := public.call_rate_per_minute(_call.call_type);

      IF _left <= 0 AND _exempt THEN
        RETURN jsonb_build_object('success', false, 'status', 'pending', 'error', 'daily_call_allowance_used');
      END IF;

      IF _left <= 0 THEN
        -- Free caller with no free time left today: only coins can pay, starting with minute 1.
        _charge := public.apply_coin_transaction(
          _call.caller_id, 'call_charge', -_rate::bigint,
          'call:' || _call.id::text || ':minute:1', _call.id,
          jsonb_build_object('minute', 1, 'rate', _rate, 'call_type', _call.call_type)
        );
        IF (_charge->>'ok')::boolean IS NOT TRUE THEN
          RETURN jsonb_build_object('success', false, 'status', 'pending',
            'error', 'daily_call_allowance_used', 'code', coalesce(_charge->>'code', 'charge_failed'));
        END IF;
        UPDATE public.video_calls
          SET status = 'accepted', accepted_at = now(),
              billing_exempt = false, billing_rate_coins = _rate, billing_free_seconds = 0,
              free_call_until = now() + interval '60 seconds',
              billed_minutes = 1, coins_charged = _rate
          WHERE id = _call.id;
      ELSE
        UPDATE public.video_calls
          SET status = 'accepted', accepted_at = now(),
              billing_exempt = _exempt,
              billing_rate_coins = CASE WHEN _exempt THEN NULL ELSE _rate END,
              billing_free_seconds = _left,
              free_call_until = now() + make_interval(secs => _left)
          WHERE id = _call.id;
      END IF;
      RETURN jsonb_build_object('success', true, 'status', 'accepted');
    END IF;

    -- Legacy per-call rules (call_daily_allowance_enabled = 0).
    UPDATE public.video_calls
      SET status = 'accepted',
          accepted_at = now(),
          billing_exempt = _exempt,
          billing_rate_coins = CASE WHEN _exempt THEN NULL ELSE public.call_rate_per_minute(_call.call_type) END,
          billing_free_seconds = CASE WHEN _exempt THEN NULL ELSE _free_seconds END,
          free_call_until = CASE WHEN _exempt THEN NULL ELSE now() + make_interval(secs => _free_seconds) END
      WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'accepted');
  ELSIF _action = 'decline' AND _uid = _call.recipient_id AND _call.status = 'pending' THEN
    UPDATE public.video_calls SET status = 'declined', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'declined');
  ELSIF _action = 'cancel' AND _uid = _call.caller_id AND _call.status = 'pending' THEN
    UPDATE public.video_calls SET status = 'cancelled', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'cancelled');
  ELSIF _action = 'end' AND _call.status = 'accepted' THEN
    UPDATE public.video_calls SET status = 'ended', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'ended');
  END IF;

  RAISE EXCEPTION 'Invalid call transition';
END
$$;

CREATE OR REPLACE FUNCTION public.extend_call_coverage(_call_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _call public.video_calls;
  _lead integer := public.billing_setting_int('call_extension_lead_seconds', 20, 1, 50);
  _remaining numeric;
  _rate integer;
  _minute integer;
  _charge jsonb;
  _allowance boolean := public.billing_setting_int('call_daily_allowance_enabled', 1, 0, 1) = 1;
BEGIN
  IF _call_id IS NULL OR _user_id IS NULL THEN RAISE EXCEPTION 'Call and user required'; END IF;

  SELECT * INTO _call FROM public.video_calls WHERE id = _call_id FOR UPDATE;
  IF _call.id IS NULL OR _user_id NOT IN (_call.caller_id, _call.recipient_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'call_not_found');
  END IF;
  IF _call.status <> 'accepted' OR _call.accepted_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'call_not_active');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.profiles caller_profile ON caller_profile.id = _call.caller_id::text
    JOIN public.profiles recipient_profile ON recipient_profile.id = _call.recipient_id::text
    WHERE m.id = _call.match_id
      AND NOT public.is_blocked_pair(m.user_a, m.user_b)
      AND caller_profile.status = 'active' AND caller_profile.onboarded AND NOT caller_profile.is_demo
      AND recipient_profile.status = 'active' AND recipient_profile.onboarded AND NOT recipient_profile.is_demo
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'call_not_allowed');
  END IF;

  IF _call.free_call_until IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'extended', false, 'exempt', true, 'covered_seconds_remaining', NULL);
  END IF;

  -- Entitlements are re-checked on the server.
  IF public.get_active_subscription_tier(_call.caller_id::text) <> 'free' THEN
    IF _allowance AND _call.billing_exempt THEN
      -- Premium stays inside today's allowance window; it is never extended and never charged.
      _remaining := extract(epoch FROM (_call.free_call_until - now()));
      IF _remaining <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'call_expired');
      END IF;
      RETURN jsonb_build_object('ok', true, 'extended', false, 'exempt', true,
        'covered_seconds_remaining', ceil(_remaining)::integer);
    END IF;
    -- Legacy: a caller who has since gone premium stops being billed.
    UPDATE public.video_calls SET billing_exempt = true, free_call_until = NULL WHERE id = _call.id;
    RETURN jsonb_build_object('ok', true, 'extended', false, 'exempt', true, 'covered_seconds_remaining', NULL);
  END IF;

  -- A short first free window (e.g. 15 s) must not trigger an immediate paid extension.
  IF _allowance AND _call.billed_minutes = 0 THEN
    _lead := least(_lead, greatest(1, floor(coalesce(_call.billing_free_seconds, 60) / 3.0)::integer));
  END IF;

  _remaining := extract(epoch FROM (_call.free_call_until - now()));
  IF _remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'call_expired');
  END IF;
  IF _remaining > _lead THEN
    RETURN jsonb_build_object(
      'ok', true, 'extended', false, 'exempt', false,
      'covered_seconds_remaining', ceil(_remaining)::integer
    );
  END IF;

  _rate := coalesce(_call.billing_rate_coins, public.call_rate_per_minute(_call.call_type));
  _minute := _call.billed_minutes + 1;
  _charge := public.apply_coin_transaction(
    _call.caller_id, 'call_charge', -_rate::bigint,
    'call:' || _call.id::text || ':minute:' || _minute::text,
    _call.id,
    jsonb_build_object('minute', _minute, 'rate', _rate, 'call_type', _call.call_type)
  );
  IF (_charge->>'ok')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', coalesce(_charge->>'code', 'charge_failed'),
      'covered_seconds_remaining', ceil(_remaining)::integer
    );
  END IF;

  UPDATE public.video_calls
    SET free_call_until = free_call_until + interval '60 seconds',
        billing_rate_coins = _rate,
        billed_minutes = _minute,
        coins_charged = coins_charged + _rate
    WHERE id = _call.id;

  RETURN jsonb_build_object(
    'ok', true, 'extended', true, 'exempt', false,
    'covered_seconds_remaining', ceil(_remaining + 60)::integer,
    'coins_charged', _rate
  );
END
$$;
