-- Phase 3 (Android incoming calls): make the recipient's Answer / Decline (and the caller's Cancel / End)
-- idempotent. Before this, repeating an action on a call that was already in the requested state raised
-- 'Invalid call transition', so a double tap or a replayed notification action looked like a failure.
-- Everything else in transition_video_call is unchanged from 20260101003200 (row lock, eligibility,
-- expiry, allowance and billing). Safe to re-apply.
BEGIN;

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
  -- Phase 3: a repeated action by the same participant on a call already in the requested state is a
  -- safe no-op (notification buttons can be tapped twice, retried after a network drop, or replayed from a
  -- cold start). No state change, no new call_events row, no second charge. Anyone else, and any other
  -- combination, still fails below.
  ELSIF _action = 'accept' AND _uid = _call.recipient_id AND _call.status = 'accepted' THEN
    RETURN jsonb_build_object('success', true, 'status', 'accepted', 'replayed', true);
  ELSIF _action = 'decline' AND _uid = _call.recipient_id AND _call.status = 'declined' THEN
    RETURN jsonb_build_object('success', true, 'status', 'declined', 'replayed', true);
  ELSIF _action = 'cancel' AND _uid = _call.caller_id AND _call.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'status', 'cancelled', 'replayed', true);
  ELSIF _action = 'end' AND _call.status = 'ended' THEN
    RETURN jsonb_build_object('success', true, 'status', 'ended', 'replayed', true);
  END IF;

  RAISE EXCEPTION 'Invalid call transition';
END
$$;

COMMIT;
