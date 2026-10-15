-- Phase 3: server-side support for the issue-call-token Edge Function.
--   1. Fixed-window per-user rate limit for call-token requests.
--   2. A read-only, service-role-only function that reports the facts the Edge Function needs to
--      authorise a join (participant, state, eligibility, remaining free time).
-- Idempotent: safe to re-apply. No provider credentials are stored or created here.

CREATE TABLE IF NOT EXISTS public.call_token_rate_limits (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (user_id, window_start)
);

ALTER TABLE public.call_token_rate_limits ENABLE ROW LEVEL SECURITY;  -- no policies: service_role only
REVOKE ALL ON public.call_token_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.call_token_rate_limits TO service_role;

INSERT INTO public.app_settings (key, value) VALUES
  ('call_token_rate_limit_per_minute', '10'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.consume_call_token_rate_limit(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _window_seconds constant integer := 60;
  _limit integer := greatest(1, public.setting_int('call_token_rate_limit_per_minute', 10));
  _now timestamptz := now();
  _window timestamptz;
  _count integer;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'User required'; END IF;
  _window := to_timestamp(floor(extract(epoch FROM _now) / _window_seconds) * _window_seconds);

  DELETE FROM public.call_token_rate_limits
  WHERE user_id = _user_id AND window_start < _now - interval '1 hour';

  INSERT INTO public.call_token_rate_limits AS r (user_id, window_start, request_count)
  VALUES (_user_id, _window, 1)
  ON CONFLICT (user_id, window_start) DO UPDATE SET request_count = r.request_count + 1
  RETURNING r.request_count INTO _count;

  RETURN jsonb_build_object(
    'allowed', _count <= _limit,
    'retry_after_seconds',
      greatest(1, ceil(extract(epoch FROM (_window + make_interval(secs => _window_seconds) - _now)))::integer)
  );
END
$$;

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

  RETURN jsonb_build_object(
    'found', true,
    'status', _call.status,
    'call_type', _call.call_type,
    'eligible', _eligible,
    'accepted', _call.accepted_at IS NOT NULL,
    'free_seconds_remaining',
      CASE WHEN _call.free_call_until IS NULL THEN NULL
        ELSE greatest(0, ceil(extract(epoch FROM (_call.free_call_until - now())))::integer) END
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.consume_call_token_rate_limit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_call_join_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_call_token_rate_limit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_call_join_context(uuid, uuid) TO service_role;
