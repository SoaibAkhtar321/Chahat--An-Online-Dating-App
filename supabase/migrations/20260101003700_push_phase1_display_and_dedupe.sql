-- 20260101003700_push_phase1_display_and_dedupe.sql
-- Chahat Phase 1 (standard push): repairs/extends the existing outbox -> dispatch-push pipeline.
-- No new tables and no new dispatcher. Changes:
--   1. notification_preferences.lock_screen_details: what a lock screen may show (none | name | preview).
--   2. Priority likes ("kind = priority") also enqueue the same privacy-safe like event.
--   3. System chat messages never enqueue a push.
--   4. get_push_display_context(): service-role-only lookup of the permitted sender first name and
--      optional preview, read at dispatch time (nothing about message content is stored in the outbox).
--   5. claim_push_deliveries(): suppress match/message pushes whose source row no longer exists.
BEGIN;

-- ---------- 1. Lock-screen detail preference ----------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS lock_screen_details text NOT NULL DEFAULT 'name'
  CHECK (lock_screen_details IN ('none', 'name', 'preview'));

-- ---------- 2. Likes: include priority likes, still never reveal the sender ----------
CREATE OR REPLACE FUNCTION public.enqueue_like_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _recipient uuid;
BEGIN
  IF NEW.kind NOT IN ('like', 'priority')
     OR NEW.from_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR NEW.to_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR EXISTS (
       SELECT 1 FROM public.matches m
       WHERE m.user_a = least(NEW.from_id, NEW.to_id)
         AND m.user_b = greatest(NEW.from_id, NEW.to_id)
     ) THEN
    RETURN NEW;
  END IF;

  _recipient := NEW.to_id::uuid;
  INSERT INTO public.notification_outbox (recipient_id, actor_id, category, event_id)
  SELECT _recipient, NEW.from_id, 'like', NEW.from_id || ':' || NEW.to_id
  WHERE EXISTS (
    SELECT 1 FROM public.profiles recipient
    JOIN public.profiles actor ON actor.id = NEW.from_id
    WHERE recipient.id = NEW.to_id AND recipient.is_demo = false
      AND recipient.status = 'active' AND recipient.onboarded
      AND actor.is_demo = false AND actor.status = 'active' AND actor.onboarded
      AND NOT public._pair_blocked(NEW.from_id, NEW.to_id)
  )
  ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_like_notification() FROM PUBLIC, anon, authenticated;

-- ---------- 3. Messages: skip system rows ----------
CREATE OR REPLACE FUNCTION public.enqueue_message_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _match public.matches;
  _recipient text;
BEGIN
  IF NEW.message_type = 'system' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO _match FROM public.matches WHERE id = NEW.match_id;
  IF _match.id IS NULL OR public._pair_blocked(_match.user_a, _match.user_b) THEN
    RETURN NEW;
  END IF;
  _recipient := CASE WHEN NEW.sender = _match.user_a THEN _match.user_b ELSE _match.user_a END;

  IF _recipient ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND NEW.sender ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    INSERT INTO public.notification_outbox (
      recipient_id, actor_id, category, event_id, route_data
    )
    SELECT _recipient::uuid, NEW.sender, 'message', NEW.id::text,
           jsonb_build_object('matchId', _match.id::text)
    WHERE EXISTS (
      SELECT 1 FROM public.profiles recipient
      JOIN public.profiles actor ON actor.id = NEW.sender
      WHERE recipient.id = _recipient AND recipient.is_demo = false
        AND recipient.status = 'active' AND recipient.onboarded
        AND actor.is_demo = false AND actor.status = 'active' AND actor.onboarded
        AND NOT public._pair_blocked(_recipient, NEW.sender)
    )
    ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_message_notification() FROM PUBLIC, anon, authenticated;

-- ---------- 4. Source-row existence + display context (internal / service role only) ----------
CREATE OR REPLACE FUNCTION public._notification_source_exists(_category text, _event_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE _category
    WHEN 'match'   THEN EXISTS (SELECT 1 FROM public.matches  WHERE id::text = _event_id)
    WHEN 'message' THEN EXISTS (SELECT 1 FROM public.messages WHERE id::text = _event_id)
    ELSE true
  END
$$;
REVOKE EXECUTE ON FUNCTION public._notification_source_exists(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_push_display_context(_notification_ids uuid[])
RETURNS TABLE (notification_id uuid, sender_name text, preview text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF _notification_ids IS NULL OR cardinality(_notification_ids) > 100 THEN
    RAISE EXCEPTION 'Invalid batch size';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    -- First name only; never for likes. Gated by the recipient's lock-screen preference.
    CASE
      WHEN o.category IN ('match', 'message')
       AND coalesce(pref.lock_screen_details, 'name') IN ('name', 'preview')
      THEN nullif(left(split_part(btrim(regexp_replace(actor.name, '[[:cntrl:]]+', ' ', 'g')), ' ', 1), 20), '')
    END,
    -- Preview only when the recipient opted in; media and view-once content is never quoted.
    CASE
      WHEN o.category = 'message'
       AND coalesce(pref.lock_screen_details, 'name') = 'preview'
       AND m.id IS NOT NULL
      THEN CASE
        WHEN m.is_view_once OR m.message_type = 'image' OR m.image_path IS NOT NULL
          THEN 'Sent you a photo'
        WHEN m.message_type = 'voice' OR m.audio_path IS NOT NULL
          THEN 'Sent you a voice message'
        WHEN btrim(m.body) <> ''
          THEN left(btrim(regexp_replace(m.body, '[[:space:][:cntrl:]]+', ' ', 'g')), 80)
        ELSE 'Sent you a message'
      END
    END
  FROM unnest(_notification_ids) AS ids(id)
  JOIN public.notification_outbox o ON o.id = ids.id
  JOIN public.profiles actor ON actor.id = o.actor_id
  LEFT JOIN public.notification_preferences pref ON pref.user_id = o.recipient_id
  LEFT JOIN public.messages m ON o.category = 'message' AND m.id::text = o.event_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_push_display_context(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_display_context(uuid[]) TO service_role;

-- ---------- 4b. Blocks must hold when no auth.uid() exists (cron / service role / system) ----------
-- public.is_blocked_pair() deliberately answers false unless the caller is one of the pair, so a block placed
-- after an event was enqueued did not stop its delivery. Every enqueue/dispatch path below uses the
-- unconditional internal helper public._pair_blocked() instead.
CREATE OR REPLACE FUNCTION public.enqueue_match_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _recipient text;
  _actor text;
BEGIN
  IF public._pair_blocked(NEW.user_a, NEW.user_b) THEN
    RETURN NEW;
  END IF;

  FOREACH _recipient IN ARRAY ARRAY[NEW.user_a, NEW.user_b] LOOP
    _actor := CASE WHEN _recipient = NEW.user_a THEN NEW.user_b ELSE NEW.user_a END;
    IF _recipient ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND _actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      INSERT INTO public.notification_outbox (
        recipient_id, actor_id, category, event_id, route_data
      )
      SELECT _recipient::uuid, _actor, 'match', NEW.id::text,
             jsonb_build_object('matchId', NEW.id::text)
      WHERE EXISTS (
        SELECT 1 FROM public.profiles recipient
        JOIN public.profiles actor ON actor.id = _actor
        WHERE recipient.id = _recipient AND recipient.is_demo = false
          AND recipient.status = 'active' AND recipient.onboarded
          AND actor.is_demo = false AND actor.status = 'active' AND actor.onboarded
          AND NOT public._pair_blocked(_recipient, _actor)
      )
      ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_match_notifications() FROM PUBLIC, anon, authenticated;

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
      AND NOT public._pair_blocked(recipient.id, actor.id)
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

-- ---------- 5. Claim: also suppress pushes whose source row is gone (and honour blocks) ----------
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
      OR public._pair_blocked(recipient.id, actor.id)
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
    AND o.category IN ('match', 'message')
    AND (
      d.status = 'pending'
      OR (d.status = 'processing' AND d.locked_at < now() - interval '5 minutes')
    )
    AND NOT public._notification_source_exists(o.category, o.event_id);

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

COMMIT;
