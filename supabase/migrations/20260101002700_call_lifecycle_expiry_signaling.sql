-- Call lifecycle completion: authoritative expiry, recipient signaling and abuse limits.
-- Additive: new table/functions, replaced functions keep their signatures. Nothing destructive.
--
-- Findings this addresses (verified against 20260101002000 / 002400):
--  * Expiry was lazy only. An abandoned pending call kept status 'pending' (blocking the
--    one-pending-per-match index and the caller's next invitation) until a participant called
--    get_my_video_calls; an abandoned accepted call with no cap (premium) stayed 'accepted'
--    forever, blocked both users from calling and was never settled.
--  * No signaling: video_calls was not in the realtime publication and no push category existed.
--  * No limit on invitation volume per caller.
BEGIN;

-- ---------- 1. Single expiry routine (service/cron + participant-scoped sweeps) ----------
-- Idempotent. Rows are claimed FOR UPDATE SKIP LOCKED and re-checked by status, so it cannot race
-- with accept/decline/cancel/end (which lock the row): whichever commits first wins and the other
-- sees a non-matching status. Ending an accepted call fires the existing settle trigger.
CREATE OR REPLACE FUNCTION public.expire_video_calls(_limit integer DEFAULT 500, _users uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _cap integer;
  _timed_out integer := 0;
  _ended integer := 0;
  _purged integer := 0;
BEGIN
  IF _limit < 1 OR _limit > 5000 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
  _cap := public.billing_setting_int('call_max_duration_seconds', 10800, 600, 86400);

  WITH due AS (
    SELECT c.id FROM public.video_calls c
    WHERE c.status = 'pending' AND c.expires_at <= now()
      AND (_users IS NULL OR c.caller_id = ANY (_users) OR c.recipient_id = ANY (_users))
    ORDER BY c.expires_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.video_calls c
  SET status = 'timed_out', ended_at = now()
  FROM due
  WHERE c.id = due.id AND c.status = 'pending';
  GET DIAGNOSTICS _timed_out = ROW_COUNT;

  -- Accepted calls end when the server-authorised time lapses (free minute / prepaid minutes), or,
  -- for unmetered calls, at the maximum duration. ended_at is the authorised end, never later.
  WITH due AS (
    SELECT c.id FROM public.video_calls c
    WHERE c.status = 'accepted' AND c.accepted_at IS NOT NULL
      AND (
        (c.free_call_until IS NOT NULL AND c.free_call_until <= now())
        OR (c.free_call_until IS NULL AND c.accepted_at + make_interval(secs => _cap) <= now())
      )
      AND (_users IS NULL OR c.caller_id = ANY (_users) OR c.recipient_id = ANY (_users))
    ORDER BY c.accepted_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.video_calls c
  SET status = 'ended',
      ended_at = least(now(), coalesce(c.free_call_until, c.accepted_at + make_interval(secs => _cap)))
  FROM due
  WHERE c.id = due.id AND c.status = 'accepted';
  GET DIAGNOSTICS _ended = ROW_COUNT;

  IF _users IS NULL THEN
    DELETE FROM public.call_events e
    WHERE e.ctid IN (
      SELECT x.ctid FROM public.call_events x
      WHERE x.created_at < now() - interval '1 day' LIMIT 5000
    );
    GET DIAGNOSTICS _purged = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('timed_out', _timed_out, 'ended', _ended, 'events_purged', _purged);
END
$$;
REVOKE EXECUTE ON FUNCTION public.expire_video_calls(integer, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_video_calls(integer, uuid[]) TO service_role;

-- ---------- 2. Signaling table (recipient-scoped, no billing columns) ----------
CREATE TABLE IF NOT EXISTS public.call_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  call_id uuid NOT NULL REFERENCES public.video_calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('incoming', 'accepted', 'declined', 'cancelled', 'timed_out', 'ended')),
  call_type text NOT NULL CHECK (call_type IN ('audio', 'video')),
  match_id uuid NOT NULL,
  caller_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_events_user_idx ON public.call_events (user_id, id DESC);
CREATE INDEX IF NOT EXISTS call_events_created_idx ON public.call_events (created_at);

ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.call_events TO authenticated;
GRANT ALL ON public.call_events TO service_role;
DROP POLICY IF EXISTS "users read own call events" ON public.call_events;
CREATE POLICY "users read own call events" ON public.call_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'call_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_events;
  END IF;
END $$;

-- ---------- 3. Push category + preference ----------
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS calls boolean NOT NULL DEFAULT true;
ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_category_check;
ALTER TABLE public.notification_outbox
  ADD CONSTRAINT notification_outbox_category_check CHECK (category IN ('like', 'match', 'message', 'call'));

-- is_blocked_pair() deliberately answers false when auth.uid() is NULL (service role / cron), so any
-- background path that must honour blocks needs a direct check. Internal only: no client or
-- service-role grant; callable from the definer functions below.
CREATE OR REPLACE FUNCTION public._pair_blocked(_a text, _b text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.blocks
                 WHERE (blocker = _a AND blocked = _b) OR (blocker = _b AND blocked = _a))
$$;
REVOKE EXECUTE ON FUNCTION public._pair_blocked(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- 4. One trigger covers every status path (RPCs, expiry, sweeps, ineligibility) ----------
CREATE OR REPLACE FUNCTION public.emit_call_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      INSERT INTO public.call_events (call_id, user_id, event, call_type, match_id, caller_id, expires_at)
      VALUES (NEW.id, NEW.recipient_id, 'incoming', NEW.call_type, NEW.match_id, NEW.caller_id, NEW.expires_at);

      INSERT INTO public.notification_outbox (recipient_id, actor_id, category, event_id, route_data)
      SELECT NEW.recipient_id, NEW.caller_id::text, 'call', NEW.id::text,
             jsonb_build_object('callId', NEW.id::text, 'matchId', NEW.match_id::text, 'callType', NEW.call_type)
      WHERE EXISTS (
        SELECT 1 FROM public.profiles r, public.profiles a
        WHERE r.id = NEW.recipient_id::text AND r.is_demo = false AND r.status = 'active' AND r.onboarded
          AND a.id = NEW.caller_id::text AND a.is_demo = false AND a.status = 'active' AND a.onboarded
          AND NOT public._pair_blocked(r.id, a.id)
      )
      ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'pending' THEN
    -- 'pending' is only ever an initial state; a reset to it is not a lifecycle event.
    INSERT INTO public.call_events (call_id, user_id, event, call_type, match_id, caller_id, expires_at)
    SELECT NEW.id, u, NEW.status, NEW.call_type, NEW.match_id, NEW.caller_id, NEW.expires_at
    FROM unnest(ARRAY[NEW.caller_id, NEW.recipient_id]) AS u;
  END IF;
  RETURN NULL;
END
$$;
REVOKE EXECUTE ON FUNCTION public.emit_call_events() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS video_calls_emit_events ON public.video_calls;
CREATE TRIGGER video_calls_emit_events
  AFTER INSERT OR UPDATE OF status ON public.video_calls
  FOR EACH ROW EXECUTE FUNCTION public.emit_call_events();

-- ---------- 5. Recovery snapshot (authoritative state for a reconnecting device) ----------
-- The client applies call_events with id > last_event_id on top of this snapshot and ignores any
-- event for a call whose snapshot status is newer. Push and Realtime are hints; this is the truth.
CREATE OR REPLACE FUNCTION public.get_call_sync()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.expire_video_calls(200, ARRAY[_uid]);
  RETURN jsonb_build_object(
    'server_time', now(),
    'last_event_id', coalesce((SELECT max(e.id) FROM public.call_events e WHERE e.user_id = _uid), 0),
    'incoming', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'call_id', c.id, 'match_id', c.match_id, 'caller_id', c.caller_id,
        'call_type', c.call_type, 'expires_at', c.expires_at) ORDER BY c.created_at DESC)
      FROM public.video_calls c JOIN public.matches m ON m.id = c.match_id
      WHERE c.recipient_id = _uid AND c.status = 'pending' AND c.expires_at > now()
        AND NOT public.is_blocked_pair(m.user_a, m.user_b)), '[]'::jsonb),
    'active', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'call_id', c.id, 'match_id', c.match_id, 'caller_id', c.caller_id, 'recipient_id', c.recipient_id,
        'call_type', c.call_type, 'accepted_at', c.accepted_at,
        'seconds_remaining', CASE WHEN c.free_call_until IS NULL THEN NULL
          ELSE greatest(0, ceil(extract(epoch FROM (c.free_call_until - now())))::integer) END))
      FROM public.video_calls c JOIN public.matches m ON m.id = c.match_id
      WHERE _uid IN (c.caller_id, c.recipient_id) AND c.status = 'accepted'
        AND NOT public.is_blocked_pair(m.user_a, m.user_b)), '[]'::jsonb)
  );
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_call_sync() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_call_sync() TO authenticated;

-- ---------- 6. create_video_call: sweep first, then bounded invitation volume ----------
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

-- ---------- 7. Push: add the call category (copied from 20260101001800 with 'call' branches) ----------
CREATE OR REPLACE FUNCTION public.materialize_push_deliveries(_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _processed integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF _limit < 1 OR _limit > 500 THEN
    RAISE EXCEPTION 'Invalid batch size';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT o.id
    FROM public.notification_outbox o
    WHERE o.processed_at IS NULL
    ORDER BY o.created_at, o.id
    FOR UPDATE SKIP LOCKED
    LIMIT _limit
  ),
  eligible AS (
    SELECT o.id AS notification_id, d.id AS device_id
    FROM candidates c
    JOIN public.notification_outbox o ON o.id = c.id
    JOIN public.profiles recipient ON recipient.id = o.recipient_id::text
    JOIN public.profiles actor ON actor.id = o.actor_id
    JOIN public.push_devices d ON d.user_id = o.recipient_id AND d.active
    LEFT JOIN public.notification_preferences pref ON pref.user_id = o.recipient_id
    WHERE recipient.is_demo = false AND recipient.status = 'active' AND recipient.onboarded
      AND actor.is_demo = false AND actor.status = 'active' AND actor.onboarded
      AND NOT public.is_blocked_pair(recipient.id, actor.id)
      AND CASE o.category
        WHEN 'like' THEN coalesce(pref.likes, true)
        WHEN 'match' THEN coalesce(pref.matches, true)
        WHEN 'message' THEN coalesce(pref.messages, true)
        WHEN 'call' THEN coalesce(pref.calls, true)
      END
      AND (o.category <> 'call' OR (
        EXISTS (
          SELECT 1 FROM public.video_calls vc
          WHERE vc.id::text = o.event_id AND vc.status = 'pending' AND vc.expires_at > now()
        )
        AND NOT public._pair_blocked(o.recipient_id::text, o.actor_id)
      ))
  ),
  inserted AS (
    INSERT INTO public.notification_deliveries (notification_id, device_id)
    SELECT notification_id, device_id FROM eligible
    ON CONFLICT (notification_id, device_id) DO NOTHING
    RETURNING id
  )
  UPDATE public.notification_outbox o
  SET processed_at = now()
  FROM candidates c
  WHERE o.id = c.id;

  GET DIAGNOSTICS _processed = ROW_COUNT;
  RETURN _processed;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.materialize_push_deliveries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_push_deliveries(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_push_deliveries(_limit integer DEFAULT 100)
RETURNS TABLE (
  delivery_id uuid,
  notification_id uuid,
  device_id uuid,
  push_token text,
  category text,
  route_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF _limit < 1 OR _limit > 100 THEN
    RAISE EXCEPTION 'Invalid batch size';
  END IF;

  UPDATE public.notification_deliveries d
  SET status = 'suppressed', last_error = 'RecipientIneligible'
  FROM public.notification_outbox o, public.profiles recipient, public.profiles actor,
       public.notification_preferences pref
  WHERE d.notification_id = o.id
    AND recipient.id = o.recipient_id::text
    AND actor.id = o.actor_id
    AND pref.user_id = o.recipient_id
    AND (
      d.status = 'pending'
      OR (d.status = 'processing' AND d.locked_at < now() - interval '5 minutes')
    )
    AND (
      recipient.is_demo OR recipient.status <> 'active' OR NOT recipient.onboarded
      OR actor.is_demo OR actor.status <> 'active' OR NOT actor.onboarded
      OR public.is_blocked_pair(recipient.id, actor.id)
      OR CASE o.category
        WHEN 'like' THEN NOT pref.likes
        WHEN 'match' THEN NOT pref.matches
        WHEN 'message' THEN NOT pref.messages
        WHEN 'call' THEN NOT pref.calls
      END
    );

  UPDATE public.notification_deliveries d
  SET status = 'suppressed', last_error = 'RecipientIneligible'
  FROM public.notification_outbox o, public.profiles recipient, public.profiles actor
  WHERE d.notification_id = o.id
    AND recipient.id = o.recipient_id::text
    AND actor.id = o.actor_id
    AND (
      d.status = 'pending'
      OR (d.status = 'processing' AND d.locked_at < now() - interval '5 minutes')
    )
    AND (
      recipient.is_demo OR recipient.status <> 'active' OR NOT recipient.onboarded
      OR actor.is_demo OR actor.status <> 'active' OR NOT actor.onboarded
      OR public.is_blocked_pair(recipient.id, actor.id)
    );

  -- A ringing push is only useful while the call is still pending and unexpired.
  UPDATE public.notification_deliveries d
  SET status = 'suppressed', last_error = 'CallNoLongerRinging'
  FROM public.notification_outbox o
  WHERE d.notification_id = o.id
    AND o.category = 'call'
    AND (
      d.status = 'pending'
      OR (d.status = 'processing' AND d.locked_at < now() - interval '5 minutes')
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.video_calls vc
        WHERE vc.id::text = o.event_id AND vc.status = 'pending' AND vc.expires_at > now()
      )
      OR public._pair_blocked(o.recipient_id::text, o.actor_id)
    );

  RETURN QUERY
  WITH due AS (
    SELECT d.id
    FROM public.notification_deliveries d
    JOIN public.notification_outbox o ON o.id = d.notification_id
    JOIN public.push_devices device ON device.id = d.device_id AND device.active
    JOIN public.profiles recipient ON recipient.id = o.recipient_id::text
    JOIN public.profiles actor ON actor.id = o.actor_id
    LEFT JOIN public.notification_preferences pref ON pref.user_id = o.recipient_id
    WHERE ((d.status = 'pending' AND d.next_attempt_at <= now())
       OR (d.status = 'processing' AND d.locked_at < now() - interval '5 minutes'))
      AND recipient.is_demo = false AND recipient.status = 'active' AND recipient.onboarded
      AND actor.is_demo = false AND actor.status = 'active' AND actor.onboarded
      AND NOT public.is_blocked_pair(recipient.id, actor.id)
      AND CASE o.category
        WHEN 'like' THEN coalesce(pref.likes, true)
        WHEN 'match' THEN coalesce(pref.matches, true)
        WHEN 'message' THEN coalesce(pref.messages, true)
        WHEN 'call' THEN coalesce(pref.calls, true)
      END
    ORDER BY d.next_attempt_at, d.created_at
    FOR UPDATE OF d SKIP LOCKED
    LIMIT _limit
  )
  UPDATE public.notification_deliveries d
  SET status = 'processing', attempt_count = d.attempt_count + 1, locked_at = now()
  FROM due, public.notification_outbox o, public.push_devices device
  WHERE d.id = due.id AND o.id = d.notification_id AND device.id = d.device_id AND device.active
  RETURNING d.id, d.notification_id, d.device_id, device.token, o.category, o.route_data;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_push_deliveries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_deliveries(integer) TO service_role;

-- ---------- 8. Scheduler: every minute, if pg_cron is available ----------
-- A missing or failing scheduler degrades to lazy sweeps (create_video_call, get_call_sync,
-- get_my_video_calls, transition_video_call); it never corrupts state. Verify after deploy with:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'expire-video-calls';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
      PERFORM cron.schedule('expire-video-calls', '* * * * *', 'SELECT public.expire_video_calls()');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'expire-video-calls was NOT scheduled (%). Enable pg_cron and schedule it manually.', SQLERRM;
    END;
  ELSE
    RAISE WARNING 'pg_cron is not available: expire-video-calls was NOT scheduled.';
  END IF;
END $$;

COMMIT;
