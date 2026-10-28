-- 20260101005800_call_allowance_hardening_and_rewind.sql
-- Pre-release hardening. Forward-only; no existing table, policy or RPC signature is changed.
--
-- 1. Daily video-call allowance: Free = 30 s/day (was 15 s), Premium/Plus/VIP = 300 s/day. IST day.
--    The caller's allowance is what a call consumes (unchanged billing rule, 20260101003200).
--
-- 2. Closes a free-time bypass in the "connected" clock (20260101005500). That clock started only when BOTH
--    phones called mark_call_connected, and a call that never reported in was counted from accept + 30 s
--    grace. A modified client could therefore join the media channel, never report "connected", and talk for
--    up to ~30 s per call without using any allowance, repeatedly (accepted calls are not rate limited).
--    Fix: the server records when it authorises each participant's media join (get_call_join_context is
--    the only path to an Agora token). Once BOTH participants hold a join grant, media can flow, so the
--    allowance clock starts then (plus call_join_slack_seconds, default 0) or when both report connected,
--    whichever is earlier; the authorised window (free_call_until, which also bounds every token TTL) is
--    re-anchored to that start. Ringing, a recipient who never joins, or a caller who never joins consume
--    nothing. Older rows without join grants keep the previous rule.
--
-- 3. get_my_video_call_allowance(): the app already calls this RPC but it never existed, so every caller was
--    treated as "free / exhausted" on the call screen. Read-only, own data only.
--
-- 4. undo_swipe_pass (Premium rewind) no longer "restores" a profile that has since blocked/been blocked,
--    been deactivated or deleted: the pass is kept and profile_unavailable is returned.
BEGIN;

INSERT INTO public.app_settings (key, value) VALUES
  ('call_free_daily_seconds', '30'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO public.app_settings (key, value) VALUES
  ('call_join_slack_seconds', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.video_calls
  ADD COLUMN IF NOT EXISTS caller_join_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS recipient_join_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS allowance_started_at timestamptz;

-- ---------- 2a. Join grants are recorded where tokens are authorised ----------
-- Same signature, same JSON keys as 20260101002400. No longer STABLE: it records the join grant.
-- Callable by service_role only (the issue-call-token Edge Function), unchanged.
CREATE OR REPLACE FUNCTION public.get_call_join_context(_call_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _call public.video_calls;
  _eligible boolean;
  _start timestamptz;
BEGIN
  SELECT * INTO _call FROM public.video_calls WHERE id = _call_id FOR UPDATE;
  IF _call.id IS NULL OR _user_id IS NULL OR _user_id NOT IN (_call.caller_id, _call.recipient_id) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  _eligible := EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.profiles caller_profile ON caller_profile.id = _call.caller_id::text
    JOIN public.profiles recipient_profile ON recipient_profile.id = _call.recipient_id::text
    WHERE m.id = _call.match_id
      AND NOT public.is_blocked_pair(m.user_a, m.user_b)
      AND caller_profile.status = 'active' AND caller_profile.onboarded AND NOT caller_profile.is_demo
      AND recipient_profile.status = 'active' AND recipient_profile.onboarded AND NOT recipient_profile.is_demo
  );

  IF _eligible AND _call.status = 'accepted' AND _call.accepted_at IS NOT NULL
     AND (_call.free_call_until IS NULL OR _call.free_call_until > now()) THEN
    IF _user_id = _call.caller_id THEN
      UPDATE public.video_calls SET caller_join_granted_at = coalesce(caller_join_granted_at, now())
        WHERE id = _call.id RETURNING * INTO _call;
    ELSE
      UPDATE public.video_calls SET recipient_join_granted_at = coalesce(recipient_join_granted_at, now())
        WHERE id = _call.id RETURNING * INTO _call;
    END IF;

    -- Both participants can now be in the channel: start the allowance clock and bound the window.
    IF _call.allowance_started_at IS NULL
       AND _call.caller_join_granted_at IS NOT NULL AND _call.recipient_join_granted_at IS NOT NULL
       AND _call.free_call_until IS NOT NULL AND coalesce(_call.billing_free_seconds, 0) > 0
       AND _call.billed_minutes = 0 THEN
      _start := greatest(_call.caller_join_granted_at, _call.recipient_join_granted_at)
                + make_interval(secs => public.billing_setting_int('call_join_slack_seconds', 0, 0, 10));
      UPDATE public.video_calls
        SET allowance_started_at = _start,
            free_call_until = least(free_call_until, _start + make_interval(secs => billing_free_seconds))
        WHERE id = _call.id RETURNING * INTO _call;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'status', _call.status,
    'call_type', _call.call_type,
    'eligible', _eligible,
    'accepted', _call.accepted_at IS NOT NULL,
    'free_seconds_remaining',
      CASE WHEN _call.free_call_until IS NULL THEN NULL
        ELSE greatest(0, ceil(extract(epoch FROM (_call.free_call_until - now())))::integer) END,
    'billing_exempt', _call.billing_exempt,
    'extension_lead_seconds', public.billing_setting_int('call_extension_lead_seconds', 20, 1, 50)
  );
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_call_join_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_call_join_context(uuid, uuid) TO service_role;

-- ---------- 2b. "Both connected" can only move the clock earlier, never restart it ----------
CREATE OR REPLACE FUNCTION public.mark_call_connected(_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _call public.video_calls;
  _start timestamptz;
  _remaining integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO _call FROM public.video_calls
  WHERE id = _call_id AND _uid IN (caller_id, recipient_id)
  FOR UPDATE;
  IF _call.id IS NULL THEN RAISE EXCEPTION 'Call not found'; END IF;
  IF _call.status <> 'accepted' THEN
    RETURN jsonb_build_object('success', false, 'status', _call.status);
  END IF;

  IF _uid = _call.caller_id THEN
    UPDATE public.video_calls SET caller_connected_at = coalesce(caller_connected_at, now())
      WHERE id = _call.id RETURNING * INTO _call;
  ELSE
    UPDATE public.video_calls SET recipient_connected_at = coalesce(recipient_connected_at, now())
      WHERE id = _call.id RETURNING * INTO _call;
  END IF;

  IF _call.connected_at IS NULL
     AND _call.caller_connected_at IS NOT NULL AND _call.recipient_connected_at IS NOT NULL THEN
    UPDATE public.video_calls SET connected_at = now() WHERE id = _call.id RETURNING * INTO _call;
    IF _call.free_call_until IS NOT NULL AND coalesce(_call.billing_free_seconds, 0) > 0
       AND _call.billed_minutes = 0 THEN
      _start := least(coalesce(_call.allowance_started_at, now()), now());
      UPDATE public.video_calls
        SET allowance_started_at = _start,
            free_call_until = _start + make_interval(secs => billing_free_seconds)
        WHERE id = _call.id RETURNING * INTO _call;
    END IF;
  END IF;

  _remaining := CASE WHEN _call.free_call_until IS NULL THEN NULL
                     ELSE greatest(0, ceil(extract(epoch FROM (_call.free_call_until - now())))::integer) END;
  RETURN jsonb_build_object(
    'success', true, 'status', _call.status,
    'both_connected', _call.connected_at IS NOT NULL,
    'seconds_remaining', _remaining
  );
END
$$;
REVOKE EXECUTE ON FUNCTION public.mark_call_connected(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_call_connected(uuid) TO authenticated;

-- ---------- 2c. Usage: from the allowance start; legacy rows keep the 005500 rule ----------
CREATE OR REPLACE FUNCTION public.call_allowance_used_today(_uid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(greatest(0, least(
           coalesce(c.billing_free_seconds, 0),
           floor(extract(epoch FROM (
             coalesce(c.ended_at, now())
             - coalesce(c.allowance_started_at,
                        c.connected_at,
                        c.accepted_at + make_interval(secs => public.billing_setting_int('call_connect_grace_seconds', 30, 0, 120)))
           )))))), 0)::integer
  FROM public.video_calls c
  WHERE c.caller_id = _uid
    AND c.accepted_at IS NOT NULL
    AND c.accepted_at >= (timezone('Asia/Kolkata', now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata';
$$;
REVOKE EXECUTE ON FUNCTION public.call_allowance_used_today(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- 3. The caller's own allowance, for the app (read-only) ----------
CREATE OR REPLACE FUNCTION public.get_my_video_call_allowance()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tier text;
  _free boolean;
  _limit integer;
  _remaining integer;
  _active uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  _tier := public.get_active_subscription_tier(_uid::text);
  _free := _tier NOT IN ('premium', 'plus', 'vip');

  SELECT c.id INTO _active FROM public.video_calls c
  WHERE _uid IN (c.caller_id, c.recipient_id)
    AND (c.status = 'accepted' OR (c.status = 'pending' AND c.expires_at > now()))
  ORDER BY c.created_at DESC LIMIT 1;

  IF public.billing_setting_int('call_daily_allowance_enabled', 1, 0, 1) <> 1 THEN
    RETURN jsonb_build_object('valid', true, 'tier', _tier, 'is_free', _free, 'daily_allowance', false,
      'daily_limit_seconds', NULL, 'seconds_remaining', NULL, 'status', 'available',
      'next_renewal_at', NULL, 'active_call_id', _active);
  END IF;

  _limit := CASE WHEN _free
                 THEN public.billing_setting_int('call_free_daily_seconds', 30, 0, 86400)
                 ELSE public.billing_setting_int('call_premium_daily_seconds', 300, 0, 86400) END;
  _remaining := greatest(0, _limit - public.call_allowance_used_today(_uid));
  RETURN jsonb_build_object(
    'valid', true, 'tier', _tier, 'is_free', _free, 'daily_allowance', true,
    'daily_limit_seconds', _limit,
    'seconds_remaining', _remaining,
    'status', CASE WHEN _remaining > 0 THEN 'available' ELSE 'exhausted' END,
    'next_renewal_at', ((timezone('Asia/Kolkata', now())::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'),
    'active_call_id', _active
  );
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_video_call_allowance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_video_call_allowance() TO authenticated;

-- ---------- 4. Premium rewind respects current eligibility ----------
CREATE OR REPLACE FUNCTION public.undo_swipe_pass(_target_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _my_id text := auth.uid()::text;
  _tier text;
  _deleted_count integer := 0;
BEGIN
  IF _my_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _target_id IS NULL OR _target_id = _my_id THEN RAISE EXCEPTION 'Target required'; END IF;

  _tier := public.get_active_subscription_tier(_my_id);
  IF _tier NOT IN ('premium', 'plus', 'vip') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'upgrade_required',
      'message', 'Rewind is only available on CHAHAT Premium, Plus, and VIP'
    );
  END IF;

  -- Never bring back someone who is blocked (either direction), deactivated, deleted or a demo account.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _target_id AND p.status = 'active' AND p.onboarded AND NOT p.is_demo
  ) OR public.is_blocked_pair(_my_id, _target_id) THEN
    RETURN jsonb_build_object('success', false, 'undone', false, 'error', 'profile_unavailable');
  END IF;

  DELETE FROM public.swipes
  WHERE from_id = _my_id AND to_id = _target_id AND kind = 'pass';
  GET DIAGNOSTICS _deleted_count = ROW_COUNT;

  RETURN jsonb_build_object('success', _deleted_count > 0, 'undone', _deleted_count > 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.undo_swipe_pass(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_swipe_pass(text) TO authenticated, service_role;

-- ---------- 5. Missing indexes on hot lookups ----------
-- "Who liked me" (get_received_likes / get_incoming_likes_count / like pushes) filters swipes by to_id, and
-- match lists filter matches by user_b; neither had an index (only (from_id, to_id) and (user_a, user_b)).
-- Plain CREATE INDEX briefly blocks writes to these tables; on a small pre-launch database that is instant.
CREATE INDEX IF NOT EXISTS swipes_to_id_created_idx ON public.swipes (to_id, created_at DESC);
CREATE INDEX IF NOT EXISTS matches_user_b_idx ON public.matches (user_b);

COMMIT;
