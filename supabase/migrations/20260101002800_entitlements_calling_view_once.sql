-- 20260101002600_entitlements_calling_view_once.sql
-- Unified Entitlements, Video Calling Quotas, View Once Images, and Progressive Radius Discovery.

-- ---------- 1. App Settings: Approved Like and Video Call Quotas ----------
-- Free: 50 likes per day, 15 seconds complimentary video calling (rolling 24h renewal)
-- Paid (₹149/7d, ₹299/15d, ₹499/1m): Unlimited likes (-1), 5 minutes (300 seconds) complimentary video calling/day
INSERT INTO public.app_settings (key, value) VALUES
  ('daily_like_limit', '50'::jsonb),
  ('daily_like_limit_premium', '-1'::jsonb),
  ('daily_like_limit_plus', '-1'::jsonb),
  ('daily_like_limit_vip', '-1'::jsonb),
  ('video_call_seconds_free', '15'::jsonb),
  ('video_call_seconds_paid', '300'::jsonb),
  ('view_once_retention_days', '14'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Helper to safely read int app settings with fallback and bounds
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

-- ---------- 2. Video Calling Quotas Table ----------
CREATE TABLE IF NOT EXISTS public.user_video_call_quotas (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  free_consumed_at timestamptz,
  paid_daily_date date,
  paid_daily_seconds_used integer NOT NULL DEFAULT 0,
  active_call_id uuid REFERENCES public.video_calls(id) ON DELETE SET NULL,
  active_call_started_at timestamptz,
  active_call_reserved_seconds integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_video_call_quotas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_video_call_quotas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_video_call_quotas TO service_role;

-- Helper: Get authoritative user video call allowance
-- Free: 15s per allowance, rolling 24-hr cooldown after consumption
-- Paid: 300s (5 mins) per day, daily reset at midnight IST
CREATE OR REPLACE FUNCTION public.get_user_video_call_allowance(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _tier text;
  _today date := (timezone('Asia/Kolkata', now()))::date;
  _quota public.user_video_call_quotas;
  _free_seconds_limit integer := public.setting_int('video_call_seconds_free', 15, 5, 3600);
  _paid_seconds_limit integer := public.setting_int('video_call_seconds_paid', 300, 10, 86400);
  _daily_limit integer;
  _seconds_remaining integer;
  _status text;
  _next_renewal timestamptz;
  _is_free boolean;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'User ID required');
  END IF;

  _tier := public.get_active_subscription_tier(_user_id::text);
  _is_free := (_tier = 'free' OR _tier IS NULL);

  SELECT * INTO _quota FROM public.user_video_call_quotas WHERE user_id = _user_id;

  IF _is_free THEN
    _daily_limit := _free_seconds_limit;
    -- Rolling 24-hour renewal: available if never consumed or >= 24h since consumption
    IF _quota.free_consumed_at IS NULL OR now() >= _quota.free_consumed_at + interval '24 hours' THEN
      _seconds_remaining := _free_seconds_limit;
      _status := 'available';
      _next_renewal := NULL;
    ELSE
      _seconds_remaining := 0;
      _status := 'exhausted';
      _next_renewal := _quota.free_consumed_at + interval '24 hours';
    END IF;
  ELSE
    _daily_limit := _paid_seconds_limit;

    -- Reset paid usage if new IST date
    IF _quota.paid_daily_date IS NULL OR _quota.paid_daily_date < _today THEN
      _seconds_remaining := _daily_limit;
    ELSE
      _seconds_remaining := greatest(0, _daily_limit - coalesce(_quota.paid_daily_seconds_used, 0));
    END IF;

    IF _seconds_remaining > 0 THEN
      _status := 'available';
      _next_renewal := NULL;
    ELSE
      _status := 'exhausted';
      _next_renewal := ((_today + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'tier', _tier,
    'is_free', _is_free,
    'daily_limit_seconds', _daily_limit,
    'seconds_remaining', _seconds_remaining,
    'status', _status,
    'next_renewal_at', _next_renewal,
    'active_call_id', _quota.active_call_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_video_call_allowance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_video_call_allowance(uuid) TO authenticated, service_role;

-- Authenticated caller wrapper
CREATE OR REPLACE FUNCTION public.get_my_video_call_allowance()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.get_user_video_call_allowance(auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_video_call_allowance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_video_call_allowance() TO authenticated, service_role;

-- ---------- 3. Like Quota RPC with Approved Tier Limits ----------
-- Free: 50 likes per day (IST)
-- Paid (₹149, ₹299, ₹499): Unlimited likes
CREATE OR REPLACE FUNCTION public.get_daily_like_quota()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
  _today date := (timezone('Asia/Kolkata', now()))::date;
  _tier text;
  _limit integer;
  _used integer := 0;
  _unlimited boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  _tier := public.get_active_subscription_tier(_uid);

  IF _tier IN ('premium', 'plus', 'vip') THEN
    _limit := -1;
    _unlimited := true;
  ELSE
    _limit := public.setting_int('daily_like_limit', 50);
  END IF;

  SELECT likes_used INTO _used
  FROM public.user_daily_quotas
  WHERE user_id = _uid AND ist_date = _today;

  RETURN jsonb_build_object(
    'tier', _tier,
    'unlimited', _unlimited,
    'daily_limit', _limit,
    'likes_remaining', CASE WHEN _unlimited THEN -1 ELSE greatest(0, _limit - coalesce(_used, 0)) END,
    'reset_at_ist', _today + 1
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_daily_like_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_like_quota() TO authenticated, service_role;

-- Hardened record_swipe with server-side tier limits
CREATE OR REPLACE FUNCTION public.record_swipe(_to_id text, _kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _from_id text := auth.uid()::text;
  _today date := (timezone('Asia/Kolkata', now()))::date;
  _tier text;
  _like_limit integer;
  _prio_limit integer := public.setting_int('daily_priority_like_limit', 3);
  _likes integer;
  _prio integer;
  _me public.profiles;
  _them public.profiles;
  _existing text;
  _match_id uuid;
  _is_match boolean := false;
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

  _tier := public.get_active_subscription_tier(_from_id);

  IF _tier IN ('premium', 'plus', 'vip') THEN
    _like_limit := -1; -- All paid tiers receive unlimited likes
  ELSE
    _like_limit := public.setting_int('daily_like_limit', 50);
  END IF;

  SELECT kind INTO _existing FROM public.swipes WHERE from_id = _from_id AND to_id = _to_id;

  -- Quota applies only when this swipe newly spends a like / priority like.
  IF _kind IN ('like','priority') AND _existing IS DISTINCT FROM _kind THEN
    INSERT INTO public.user_daily_quotas (user_id, ist_date) VALUES (_from_id, _today)
      ON CONFLICT (user_id, ist_date) DO NOTHING;
    SELECT likes_used, super_likes_used INTO _likes, _prio FROM public.user_daily_quotas
      WHERE user_id = _from_id AND ist_date = _today FOR UPDATE;

    -- Quota check (unless unlimited for paid tiers)
    IF _kind = 'like' AND _like_limit > 0 AND _likes >= _like_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'daily_like_limit_reached',
        'likes_remaining', 0,
        'reset_at_ist', _today + 1
      );
    END IF;

    IF _kind = 'priority' AND _prio >= _prio_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'daily_super_like_limit_reached',
        'super_likes_remaining', 0,
        'likes_remaining', CASE WHEN _like_limit < 0 THEN -1 ELSE greatest(0, _like_limit - _likes) END,
        'reset_at_ist', _today + 1
      );
    END IF;

    UPDATE public.user_daily_quotas
      SET likes_used = likes_used + (CASE WHEN _kind = 'like' THEN 1 ELSE 0 END),
          super_likes_used = super_likes_used + (CASE WHEN _kind = 'priority' THEN 1 ELSE 0 END),
          updated_at = now()
      WHERE user_id = _from_id AND ist_date = _today
      RETURNING likes_used, super_likes_used INTO _likes, _prio;
  ELSE
    SELECT coalesce(likes_used,0), coalesce(super_likes_used,0) INTO _likes, _prio
      FROM public.user_daily_quotas WHERE user_id = _from_id AND ist_date = _today;
  END IF;

  -- Upsert swipe
  INSERT INTO public.swipes (from_id, to_id, kind)
  VALUES (_from_id, _to_id, _kind)
  ON CONFLICT (from_id, to_id)
  DO UPDATE SET kind = EXCLUDED.kind, created_at = now();

  -- Check mutual like for instant match
  IF _kind IN ('like','priority') THEN
    IF EXISTS (
      SELECT 1 FROM public.swipes
      WHERE from_id = _to_id AND to_id = _from_id AND kind IN ('like','priority')
    ) THEN
      SELECT id INTO _match_id FROM public.matches
      WHERE (user_a = _from_id AND user_b = _to_id) OR (user_a = _to_id AND user_b = _from_id);
      _is_match := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'kind', _kind,
    'match', _is_match,
    'match_id', _match_id,
    'likes_remaining', CASE WHEN _like_limit < 0 THEN -1 ELSE greatest(0, _like_limit - coalesce(_likes, 0)) END,
    'super_likes_remaining', greatest(0, _prio_limit - coalesce(_prio, 0)),
    'reset_at_ist', _today + 1
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_swipe(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_swipe(text, text) TO authenticated, service_role;

-- ---------- 4. Video Call Lifecycle & Atomic Accounting ----------

-- Call creation: validates caller allowance before initiating
CREATE OR REPLACE FUNCTION public.create_video_call(_match_id uuid, _call_type text DEFAULT 'video')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _caller_id uuid := auth.uid();
  _recipient_id uuid;
  _match public.matches;
  _caller_allowance jsonb;
  _recipient_allowance jsonb;
  _call_id uuid;
BEGIN
  IF _caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _match_id IS NULL THEN RAISE EXCEPTION 'Match ID required'; END IF;
  IF _call_type IS NULL OR _call_type <> 'video' THEN
    -- Video calling is the only calling feature. Do not build separate audio-only calling.
    _call_type := 'video';
  END IF;

  -- Look up match
  SELECT * INTO _match FROM public.matches WHERE id = _match_id;
  IF _match.id IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;
  IF _caller_id::text NOT IN (_match.user_a, _match.user_b) THEN
    RAISE EXCEPTION 'Not a member of this match';
  END IF;

  _recipient_id := CASE WHEN _match.user_a = _caller_id::text THEN _match.user_b::uuid ELSE _match.user_a::uuid END;

  -- Eligibility check
  IF public.is_blocked_pair(_caller_id::text, _recipient_id::text) THEN
    RAISE EXCEPTION 'Call cannot be placed to this user';
  END IF;

  -- Check caller's calling quota
  _caller_allowance := public.get_user_video_call_allowance(_caller_id);
  IF (_caller_allowance->>'seconds_remaining')::integer <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'calling_quota_exhausted',
      'message', 'Your video calling allowance is exhausted.',
      'tier', _caller_allowance->>'tier',
      'next_renewal_at', _caller_allowance->>'next_renewal_at'
    );
  END IF;

  -- Check recipient's calling quota
  _recipient_allowance := public.get_user_video_call_allowance(_recipient_id);
  IF (_recipient_allowance->>'seconds_remaining')::integer <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'recipient_quota_exhausted',
      'message', 'The recipient cannot accept video calls right now.',
      'next_renewal_at', _recipient_allowance->>'next_renewal_at'
    );
  END IF;

  -- Prevent concurrent calls for caller
  IF EXISTS (
    SELECT 1 FROM public.video_calls
    WHERE (caller_id = _caller_id OR recipient_id = _caller_id)
      AND status IN ('pending', 'accepted')
      AND (expires_at > now() OR (free_call_until IS NOT NULL AND free_call_until > now()))
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'call_already_in_progress');
  END IF;

  _call_id := gen_random_uuid();
  INSERT INTO public.video_calls (
    id, match_id, caller_id, recipient_id, call_type, status,
    created_at, expires_at
  ) VALUES (
    _call_id, _match_id, _caller_id, _recipient_id, 'video', 'pending',
    now(), now() + interval '45 seconds'
  );

  RETURN jsonb_build_object(
    'success', true,
    'call_id', _call_id,
    'status', 'pending',
    'caller_seconds_remaining', (_caller_allowance->>'seconds_remaining')::integer,
    'recipient_seconds_remaining', (_recipient_allowance->>'seconds_remaining')::integer
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_video_call(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_video_call(uuid, text) TO authenticated, service_role;

-- Call transition with atomic quota reservation and settlement
CREATE OR REPLACE FUNCTION public.transition_video_call(_call_id uuid, _action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _call public.video_calls;
  _caller_allowance jsonb;
  _recipient_allowance jsonb;
  _authorized_seconds integer;
  _elapsed_seconds integer := 0;
  _today date := (timezone('Asia/Kolkata', now()))::date;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _action NOT IN ('accept', 'decline', 'cancel', 'end') THEN RAISE EXCEPTION 'Invalid call action'; END IF;

  SELECT * INTO _call FROM public.video_calls
  WHERE id = _call_id AND _uid IN (caller_id, recipient_id)
  FOR UPDATE;
  IF _call.id IS NULL THEN RAISE EXCEPTION 'Call not found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.profiles cp ON cp.id = _call.caller_id::text
    JOIN public.profiles rp ON rp.id = _call.recipient_id::text
    WHERE m.id = _call.match_id
      AND NOT public.is_blocked_pair(m.user_a, m.user_b)
      AND cp.status = 'active' AND cp.onboarded AND NOT cp.is_demo
      AND rp.status = 'active' AND rp.onboarded AND NOT rp.is_demo
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

  IF _call.status = 'accepted' AND _call.free_call_until IS NOT NULL AND _call.free_call_until <= now() THEN
    _action := 'end';
  END IF;

  -- 1. ACCEPT ACTION
  IF _action = 'accept' AND _uid = _call.recipient_id AND _call.status = 'pending' THEN
    -- Evaluate both allowances independently
    _caller_allowance := public.get_user_video_call_allowance(_call.caller_id);
    _recipient_allowance := public.get_user_video_call_allowance(_call.recipient_id);

    IF (_caller_allowance->>'seconds_remaining')::integer <= 0 THEN
      UPDATE public.video_calls SET status = 'declined', ended_at = now() WHERE id = _call.id;
      RETURN jsonb_build_object('success', false, 'error', 'caller_quota_exhausted');
    END IF;

    IF (_recipient_allowance->>'seconds_remaining')::integer <= 0 THEN
      UPDATE public.video_calls SET status = 'declined', ended_at = now() WHERE id = _call.id;
      RETURN jsonb_build_object('success', false, 'error', 'recipient_quota_exhausted');
    END IF;

    -- Joint call authorized duration is the minimum of both participants' available allowance
    _authorized_seconds := least(
      (_caller_allowance->>'seconds_remaining')::integer,
      (_recipient_allowance->>'seconds_remaining')::integer
    );

    UPDATE public.video_calls
      SET status = 'accepted',
          accepted_at = now(),
          billing_exempt = false,
          billing_free_seconds = _authorized_seconds,
          free_call_until = now() + make_interval(secs => _authorized_seconds)
      WHERE id = _call.id;

    -- Atomically record active call reservation in quotas
    INSERT INTO public.user_video_call_quotas (user_id, active_call_id, active_call_started_at, active_call_reserved_seconds, updated_at)
    VALUES (_call.caller_id, _call.id, now(), _authorized_seconds, now())
    ON CONFLICT (user_id) DO UPDATE SET
      active_call_id = _call.id,
      active_call_started_at = now(),
      active_call_reserved_seconds = _authorized_seconds,
      updated_at = now();

    INSERT INTO public.user_video_call_quotas (user_id, active_call_id, active_call_started_at, active_call_reserved_seconds, updated_at)
    VALUES (_call.recipient_id, _call.id, now(), _authorized_seconds, now())
    ON CONFLICT (user_id) DO UPDATE SET
      active_call_id = _call.id,
      active_call_started_at = now(),
      active_call_reserved_seconds = _authorized_seconds,
      updated_at = now();

    RETURN jsonb_build_object(
      'success', true,
      'status', 'accepted',
      'authorized_seconds', _authorized_seconds,
      'call_until', now() + make_interval(secs => _authorized_seconds)
    );

  ELSIF _action = 'decline' AND _uid = _call.recipient_id AND _call.status = 'pending' THEN
    UPDATE public.video_calls SET status = 'declined', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'declined');

  ELSIF _action = 'cancel' AND _uid = _call.caller_id AND _call.status = 'pending' THEN
    UPDATE public.video_calls SET status = 'cancelled', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'cancelled');

  -- 2. END ACTION (Settle Quotas)
  ELSIF _action = 'end' AND _call.status = 'accepted' THEN
    _elapsed_seconds := greatest(1, ceil(extract(epoch FROM (now() - _call.accepted_at)))::integer);
    IF _call.billing_free_seconds IS NOT NULL THEN
      _elapsed_seconds := least(_elapsed_seconds, _call.billing_free_seconds);
    END IF;

    UPDATE public.video_calls SET status = 'ended', ended_at = now() WHERE id = _call.id;

    -- Settle Caller
    _caller_allowance := public.get_user_video_call_allowance(_call.caller_id);
    IF (_caller_allowance->>'is_free')::boolean THEN
      UPDATE public.user_video_call_quotas
      SET free_consumed_at = now(),
          active_call_id = NULL,
          active_call_reserved_seconds = 0,
          updated_at = now()
      WHERE user_id = _call.caller_id;
    ELSE
      UPDATE public.user_video_call_quotas
      SET paid_daily_date = _today,
          paid_daily_seconds_used = CASE
            WHEN paid_daily_date = _today THEN paid_daily_seconds_used + _elapsed_seconds
            ELSE _elapsed_seconds
          END,
          active_call_id = NULL,
          active_call_reserved_seconds = 0,
          updated_at = now()
      WHERE user_id = _call.caller_id;
    END IF;

    -- Settle Recipient
    _recipient_allowance := public.get_user_video_call_allowance(_call.recipient_id);
    IF (_recipient_allowance->>'is_free')::boolean THEN
      UPDATE public.user_video_call_quotas
      SET free_consumed_at = now(),
          active_call_id = NULL,
          active_call_reserved_seconds = 0,
          updated_at = now()
      WHERE user_id = _call.recipient_id;
    ELSE
      UPDATE public.user_video_call_quotas
      SET paid_daily_date = _today,
          paid_daily_seconds_used = CASE
            WHEN paid_daily_date = _today THEN paid_daily_seconds_used + _elapsed_seconds
            ELSE _elapsed_seconds
          END,
          active_call_id = NULL,
          active_call_reserved_seconds = 0,
          updated_at = now()
      WHERE user_id = _call.recipient_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'ended', 'elapsed_seconds', _elapsed_seconds);
  END IF;

  RAISE EXCEPTION 'Invalid call transition';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transition_video_call(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_video_call(uuid, text) TO authenticated, service_role;

-- Update get_call_join_context to return allowance status
CREATE OR REPLACE FUNCTION public.get_call_join_context(_call_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _call public.video_calls;
  _eligible boolean;
  _remaining_seconds integer;
  _allowance jsonb;
BEGIN
  SELECT * INTO _call FROM public.video_calls WHERE id = _call_id;
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

  _allowance := public.get_user_video_call_allowance(_user_id);

  IF _call.free_call_until IS NULL THEN
    _remaining_seconds := (_allowance->>'seconds_remaining')::integer;
  ELSE
    _remaining_seconds := greatest(0, ceil(extract(epoch FROM (_call.free_call_until - now())))::integer);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'status', _call.status,
    'call_type', 'video',
    'eligible', _eligible,
    'accepted', _call.accepted_at IS NOT NULL,
    'free_seconds_remaining', _remaining_seconds,
    'seconds_remaining', _remaining_seconds,
    'billing_exempt', false,
    'allowance_status', _allowance->>'status',
    'tier', _allowance->>'tier'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_call_join_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_call_join_context(uuid, uuid) TO service_role;

-- ---------- 5. View Once Media Support in Messages ----------
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

-- Update get_match_messages to include View Once metadata (masking image_path if consumed by recipient)
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _my_id text := auth.uid()::text;
  _match public.matches;
  _tier text;
  _show_read_receipts boolean;
BEGIN
  IF _my_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO _match FROM public.matches WHERE public.matches.id = _match_id;
  IF _match.id IS NULL OR (_match.user_a <> _my_id AND _match.user_b <> _my_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF public.is_blocked_pair(_match.user_a, _match.user_b) THEN
    RETURN;
  END IF;

  _tier := public.get_active_subscription_tier(_my_id);
  _show_read_receipts := _tier IN ('plus', 'vip');

  RETURN QUERY
  SELECT
    m.id,
    m.match_id,
    m.sender,
    m.body,
    -- If View Once and already viewed by recipient, do not return image_path to recipient
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
    CASE WHEN _show_read_receipts THEN m.read_at ELSE NULL END AS read_at
  FROM public.messages m
  WHERE m.match_id = _match_id
  ORDER BY m.created_at DESC
  LIMIT greatest(1, least(_limit, 100));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_match_messages(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_messages(uuid, integer) TO authenticated, service_role;

-- ---------- 6. Location Discovery with Progressive Radius Expansion ----------
-- Adds _min_radius_km parameter so client can expand 3km -> 5km -> 10km without duplicates
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
  ),
  filtered AS (
    SELECT
      rc.id,
      rc.name,
      rc.age,
      rc.city,
      rc.bio,
      rc.work,
      rc.education,
      rc.interests,
      rc.intents,
      rc.languages,
      rc.lifestyle,
      rc.prompt,
      rc.photos,
      -- Approximate distance without exposing precise coordinates
      CASE
        WHEN rc.exact_distance_m IS NULL THEN NULL
        ELSE greatest(1, ceil(rc.exact_distance_m / 1000.0)::integer)
      END AS distance_km,
      coalesce(round(rc.exact_distance_m)::integer, 2147483647) AS cursor_distance_m
    FROM raw_candidates rc
    WHERE rc.age BETWEEN _age_min AND _age_max
      AND (
        rc.exact_distance_m IS NULL
        OR (
          rc.exact_distance_m <= (_radius_km * 1000.0)
          AND rc.exact_distance_m >= (_min_radius_km * 1000.0)
        )
      )
      AND (cardinality(_intents) = 0 OR rc.intents && _intents)
      AND (cardinality(_interests) = 0 OR rc.interests && _interests)
      AND (cardinality(_languages) = 0 OR rc.languages && _languages)
  )
  SELECT
    f.id,
    f.name,
    f.age,
    f.city,
    f.bio,
    f.work,
    f.education,
    f.interests,
    f.intents,
    f.languages,
    f.lifestyle,
    f.prompt,
    f.photos,
    f.distance_km,
    f.cursor_distance_m
  FROM filtered f
  WHERE (
    _after_distance_m IS NULL
    OR f.cursor_distance_m > _after_distance_m
    OR (f.cursor_distance_m = _after_distance_m AND f.id > _after_id)
  )
  ORDER BY f.cursor_distance_m ASC, f.id ASC
  LIMIT _limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_discovery_feed_page(integer, integer, integer, integer, text[], text[], text[], integer, text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discovery_feed_page(integer, integer, integer, integer, text[], text[], text[], integer, text[], integer) TO authenticated;

-- ---------- 7. Google Play Product Mapping for New Packages ----------
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

  -- Catalog: supports new packages (₹149/7d, ₹299/15d, ₹499/1m) and legacy products
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

    IF _tier_rank < _current_tier_rank AND _subscription.expires_at > _expires_at THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', _order.id,
        'tier', _subscription.tier,
        'expires_at', _subscription.expires_at,
        'is_replay', _was_replay,
        'entitlement_updated', false
      );
    END IF;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.user_subscriptions (
      user_id, tier, status, starts_at, expires_at, auto_renew, source_order_id, created_at, updated_at
    ) VALUES (
      _uid::text, _tier, 'active', _starts_at, _expires_at, coalesce(_auto_renew, false), _order.id, now(), now()
    ) RETURNING * INTO _subscription;
    _entitlement_updated := true;
  ELSE
    UPDATE public.user_subscriptions
    SET tier = _tier,
        status = 'active',
        starts_at = least(starts_at, _starts_at),
        expires_at = greatest(expires_at, _expires_at),
        auto_renew = coalesce(_auto_renew, auto_renew),
        source_order_id = _order.id,
        updated_at = now()
    WHERE user_id = _uid::text
    RETURNING * INTO _subscription;
    _entitlement_updated := true;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', _order.id,
    'tier', _subscription.tier,
    'expires_at', _subscription.expires_at,
    'is_replay', _was_replay,
    'entitlement_updated', _entitlement_updated
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_verified_google_purchase(text, text, text, text, timestamptz, timestamptz, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_google_purchase(text, text, text, text, timestamptz, timestamptz, boolean, text) TO service_role;
