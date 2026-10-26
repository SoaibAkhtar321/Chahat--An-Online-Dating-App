-- 20260101005500_call_connect_clock_and_history.sql
-- Video-call fixes (forward-only, does not redefine transition_video_call):
--   1. The free/premium allowance clock starts when BOTH people are actually connected, not when the
--      recipient taps Answer. Before this, the seconds spent joining (and the caller learning that the
--      call was accepted) were burned, so a 15 s allowance was gone before anyone saw a face and the user
--      "got" several 5-6 s calls instead of one 15 s call.
--   2. Accepting a call gets a short connection grace (call_connect_grace_seconds, default 30) so the
--      call is not expired by the server while both phones are still joining.
--   3. Allowance usage counts only connected time. A call that never connects burns nothing, but a client
--      that never reports "connected" cannot farm free time either (usage then counts from accept + grace).
--   4. Call outcomes are written to the chat as system messages (missed / declined / ended with duration),
--      like WhatsApp. System messages never trigger a message push (see push_phase1 migration).
BEGIN;

ALTER TABLE public.video_calls
  ADD COLUMN IF NOT EXISTS caller_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS recipient_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS connected_at timestamptz;

INSERT INTO public.app_settings (key, value) VALUES
  ('call_connect_grace_seconds', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------- 1. Grace window at accept ----------
CREATE OR REPLACE FUNCTION public.video_calls_connect_grace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted'
     AND NEW.free_call_until IS NOT NULL
     AND coalesce(NEW.billing_free_seconds, 0) > 0 THEN
    NEW.free_call_until := NEW.free_call_until
      + make_interval(secs => public.billing_setting_int('call_connect_grace_seconds', 30, 0, 120));
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.video_calls_connect_grace() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS video_calls_connect_grace ON public.video_calls;
CREATE TRIGGER video_calls_connect_grace
  BEFORE UPDATE OF status ON public.video_calls
  FOR EACH ROW
  EXECUTE FUNCTION public.video_calls_connect_grace();

-- ---------- 2. Each phone reports "connected"; the clock starts when both have ----------
CREATE OR REPLACE FUNCTION public.mark_call_connected(_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _call public.video_calls;
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
    UPDATE public.video_calls
      SET connected_at = now(),
          free_call_until = CASE
            WHEN free_call_until IS NOT NULL AND coalesce(billing_free_seconds, 0) > 0 AND billed_minutes = 0
              THEN now() + make_interval(secs => billing_free_seconds)
            ELSE free_call_until END
      WHERE id = _call.id RETURNING * INTO _call;
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

-- ---------- 3. Allowance counts connected time only ----------
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
             - coalesce(c.connected_at,
                        c.accepted_at + make_interval(secs => public.billing_setting_int('call_connect_grace_seconds', 30, 0, 120)))
           )))))), 0)::integer
  FROM public.video_calls c
  WHERE c.caller_id = _uid
    AND c.accepted_at IS NOT NULL
    AND c.accepted_at >= (timezone('Asia/Kolkata', now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata';
$$;
REVOKE EXECUTE ON FUNCTION public.call_allowance_used_today(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- 4. Call history in the chat ----------
-- Body format (parsed by mobile/src/utils/callEvents.ts):  call|video|<outcome>|<call_id>|<seconds>
-- outcome: missed (no answer / cancelled / never connected) | declined | ended (connected, seconds > 0)
CREATE OR REPLACE FUNCTION public.video_calls_history_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _outcome text;
  _secs integer := 0;
BEGIN
  IF OLD.status NOT IN ('pending', 'accepted') OR NEW.status IN ('pending', 'accepted') THEN
    RETURN NULL;
  END IF;

  IF NEW.status = 'declined' THEN
    _outcome := 'declined';
  ELSIF NEW.status IN ('cancelled', 'timed_out') THEN
    _outcome := 'missed';
  ELSIF NEW.connected_at IS NOT NULL THEN
    _outcome := 'ended';
    _secs := greatest(0, floor(extract(epoch FROM (coalesce(NEW.ended_at, now()) - NEW.connected_at)))::integer);
  ELSE
    _outcome := 'missed';
  END IF;

  INSERT INTO public.messages (match_id, sender, body, message_type)
  VALUES (NEW.match_id, NEW.caller_id::text,
          'call|' || NEW.call_type || '|' || _outcome || '|' || NEW.id::text || '|' || _secs::text,
          'system');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Chat history must never block a call state change.
  RETURN NULL;
END
$$;
REVOKE EXECUTE ON FUNCTION public.video_calls_history_message() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS video_calls_history_message ON public.video_calls;
CREATE TRIGGER video_calls_history_message
  AFTER UPDATE OF status ON public.video_calls
  FOR EACH ROW
  WHEN (OLD.status IN ('pending', 'accepted') AND NEW.status NOT IN ('pending', 'accepted'))
  EXECUTE FUNCTION public.video_calls_history_message();

COMMIT;
