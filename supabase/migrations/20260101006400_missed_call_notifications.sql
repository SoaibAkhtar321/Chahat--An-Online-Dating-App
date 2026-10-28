-- 20260101006400_missed_call_notifications.sql
-- A call that was never answered (the caller cancelled, or it rang out) now sends the callee a normal push:
-- "Missed video call" / "Missed audio call", which opens the chat. Before this, a missed call only appeared as a
-- system line inside the chat (system messages never push), so a member whose app was closed never learned of it.
--   * New outbox category 'missed_call' (respects the existing "Calls" notification preference).
--   * Sent once per call (unique recipient/category/event), only for unanswered calls, never to the caller,
--     never for blocked/inactive/demo accounts (same eligibility as every other push).
--   * Delivered on the normal channel, not the ringing channel; no caller name on the lock screen (same privacy
--     rule as the ringing call push).
-- Forward-only; no signature changes.
BEGIN;

ALTER TABLE public.notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_category_check;
ALTER TABLE public.notification_outbox ADD CONSTRAINT notification_outbox_category_check
  CHECK (category = ANY (ARRAY['like'::text, 'match'::text, 'message'::text, 'call'::text, 'missed_call'::text]));

CREATE OR REPLACE FUNCTION public._notification_source_exists(_category text, _event_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT CASE _category
    WHEN 'match'   THEN EXISTS (SELECT 1 FROM public.matches  WHERE id::text = _event_id)
    WHEN 'message' THEN EXISTS (SELECT 1 FROM public.messages WHERE id::text = _event_id AND deleted_at IS NULL)
    WHEN 'missed_call' THEN EXISTS (SELECT 1 FROM public.video_calls WHERE id::text = _event_id
                                    AND status IN ('cancelled', 'timed_out') AND accepted_at IS NULL)
    ELSE true
  END
$function$;

CREATE OR REPLACE FUNCTION public.materialize_push_deliveries(_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
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
      AND NOT public._pair_blocked(recipient.id, actor.id)
      AND CASE o.category
        WHEN 'like' THEN coalesce(pref.likes, true)
        WHEN 'match' THEN coalesce(pref.matches, true)
        WHEN 'message' THEN coalesce(pref.messages, true)
        WHEN 'call' THEN coalesce(pref.calls, true)
        WHEN 'missed_call' THEN coalesce(pref.calls, true)
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_push_deliveries(_limit integer DEFAULT 100)
 RETURNS TABLE(delivery_id uuid, notification_id uuid, device_id uuid, push_token text, category text, route_data jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
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
      OR public._pair_blocked(recipient.id, actor.id)
      OR CASE o.category
        WHEN 'like' THEN NOT pref.likes
        WHEN 'match' THEN NOT pref.matches
        WHEN 'message' THEN NOT pref.messages
        WHEN 'call' THEN NOT pref.calls
        WHEN 'missed_call' THEN NOT pref.calls
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
      OR public._pair_blocked(recipient.id, actor.id)
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

  -- Phase 1: a match / message push is pointless once the underlying row is gone (unmatched, deleted).
  UPDATE public.notification_deliveries d
  SET status = 'suppressed', last_error = 'SourceGone'
  FROM public.notification_outbox o
  WHERE d.notification_id = o.id
    AND o.category IN ('match', 'message', 'missed_call')
    AND (
      d.status = 'pending'
      OR (d.status = 'processing' AND d.locked_at < now() - interval '5 minutes')
    )
    AND NOT public._notification_source_exists(o.category, o.event_id);

  -- Phase 2: a like push is pointless (and must not reveal anything) once the like is no longer a valid,
  -- unanswered, non-blocked like between two active accounts.
  UPDATE public.notification_deliveries d
  SET status = 'suppressed', last_error = 'LikeNoLongerValid'
  FROM public.notification_outbox o
  WHERE d.notification_id = o.id
    AND o.category = 'like'
    AND (
      d.status = 'pending'
      OR (d.status = 'processing' AND d.locked_at < now() - interval '5 minutes')
    )
    AND NOT public._like_is_valid(o.actor_id, o.recipient_id::text);

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
      AND NOT public._pair_blocked(recipient.id, actor.id)
      AND public._notification_source_exists(o.category, o.event_id)
      AND (o.category <> 'like' OR public._like_is_valid(o.actor_id, o.recipient_id::text))
      AND CASE o.category
        WHEN 'like' THEN coalesce(pref.likes, true)
        WHEN 'match' THEN coalesce(pref.matches, true)
        WHEN 'message' THEN coalesce(pref.messages, true)
        WHEN 'call' THEN coalesce(pref.calls, true)
        WHEN 'missed_call' THEN coalesce(pref.calls, true)
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
$function$;

CREATE OR REPLACE FUNCTION public.emit_call_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
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

    -- 006400: an unanswered call tells the callee with a normal push.
    IF OLD.status = 'pending' AND NEW.status IN ('cancelled', 'timed_out') AND NEW.accepted_at IS NULL THEN
      INSERT INTO public.notification_outbox (recipient_id, actor_id, category, event_id, route_data)
      SELECT NEW.recipient_id, NEW.caller_id::text, 'missed_call', NEW.id::text,
             jsonb_build_object('callId', NEW.id::text, 'matchId', NEW.match_id::text, 'callType', NEW.call_type)
      WHERE EXISTS (
        SELECT 1 FROM public.profiles r, public.profiles a
        WHERE r.id = NEW.recipient_id::text AND r.is_demo = false AND r.status = 'active' AND r.onboarded
          AND a.id = NEW.caller_id::text AND a.is_demo = false AND a.status = 'active' AND a.onboarded
          AND NOT public._pair_blocked(r.id, a.id)
      )
      ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END
$function$;

COMMIT;
