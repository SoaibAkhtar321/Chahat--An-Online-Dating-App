-- Provider-neutral one-to-one call invitations and server-owned lifecycle.
-- No room credentials or provider tokens are created by this migration.

CREATE TABLE public.video_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_type text NOT NULL CHECK (call_type IN ('audio', 'video')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'timed_out', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  ended_at timestamptz,
  free_call_until timestamptz,
  CHECK (caller_id <> recipient_id)
);

CREATE INDEX video_calls_participant_created_idx
  ON public.video_calls (caller_id, created_at DESC);
CREATE INDEX video_calls_recipient_created_idx
  ON public.video_calls (recipient_id, created_at DESC);
CREATE UNIQUE INDEX video_calls_one_pending_per_match_idx
  ON public.video_calls (match_id)
  WHERE status = 'pending';

ALTER TABLE public.video_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.video_calls TO authenticated;
GRANT ALL ON public.video_calls TO service_role;

CREATE POLICY "participants read calls" ON public.video_calls
  FOR SELECT TO authenticated
  USING (caller_id = auth.uid() OR recipient_id = auth.uid());

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

  IF EXISTS (
    SELECT 1 FROM public.video_calls c
    WHERE (c.status = 'accepted' OR (c.status = 'pending' AND c.expires_at > _now))
      AND (_uid IN (c.caller_id, c.recipient_id))
  ) THEN
    RAISE EXCEPTION 'A participant already has an active call';
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

CREATE OR REPLACE FUNCTION public.transition_video_call(_call_id uuid, _action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _call public.video_calls;
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
    UPDATE public.video_calls
      SET status = 'accepted',
          accepted_at = now(),
          free_call_until = CASE
            WHEN public.get_active_subscription_tier(_call.caller_id::text) = 'free'
              OR public.get_active_subscription_tier(_call.recipient_id::text) = 'free'
            THEN now() + interval '60 seconds'
            ELSE NULL
          END
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

CREATE OR REPLACE FUNCTION public.get_my_video_calls()
RETURNS TABLE (
  id uuid,
  match_id uuid,
  caller_id uuid,
  recipient_id uuid,
  call_type text,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  free_seconds_remaining integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.video_calls c
    SET status = 'timed_out', ended_at = now()
    WHERE c.status = 'pending' AND c.expires_at <= now()
      AND _uid IN (c.caller_id, c.recipient_id);
  UPDATE public.video_calls c
    SET status = 'ended', ended_at = now()
    WHERE c.status = 'accepted' AND c.free_call_until IS NOT NULL
      AND c.free_call_until <= now() AND _uid IN (c.caller_id, c.recipient_id);

  RETURN QUERY SELECT c.id, c.match_id, c.caller_id, c.recipient_id, c.call_type,
    c.status, c.created_at, c.expires_at,
    CASE WHEN c.free_call_until IS NULL THEN NULL
      ELSE greatest(0, ceil(extract(epoch FROM (c.free_call_until - now())))::integer) END
  FROM public.video_calls c
  WHERE _uid IN (c.caller_id, c.recipient_id)
    AND c.created_at >= now() - interval '7 days'
  ORDER BY c.created_at DESC
  LIMIT 50;
END
$$;

REVOKE EXECUTE ON FUNCTION public.create_video_call(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transition_video_call(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_video_calls() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_video_call(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_video_call(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_video_calls() TO authenticated;
