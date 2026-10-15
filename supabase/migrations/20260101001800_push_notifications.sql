BEGIN;

CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  matches boolean NOT NULL DEFAULT true,
  messages boolean NOT NULL DEFAULT true,
  likes boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
CREATE POLICY "read own notification preferences" ON public.notification_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "insert own notification preferences" ON public.notification_preferences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "update own notification preferences" ON public.notification_preferences
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT ALL ON public.notification_preferences TO service_role;

CREATE TABLE public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE CHECK (
    token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,256}\]$'
  ),
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version text CHECK (app_version IS NULL OR app_version ~ '^[A-Za-z0-9.+-]{1,32}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_active_user_idx ON public.push_devices (user_id) WHERE active;
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_devices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.push_devices TO service_role;

CREATE OR REPLACE FUNCTION public.register_push_device(
  _token text,
  _platform text,
  _app_version text DEFAULT NULL,
  _previous_token text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _active_devices integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF _token IS NULL OR length(_token) > 300
     OR _token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,256}\]$' THEN
    RAISE EXCEPTION 'Invalid Expo push token';
  END IF;
  IF _platform IS NULL OR _platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Unsupported push platform';
  END IF;
  IF _app_version IS NOT NULL AND _app_version !~ '^[A-Za-z0-9.+-]{1,32}$' THEN
    RAISE EXCEPTION 'Invalid app version';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_uid::text));
  IF _previous_token IS NOT NULL AND _previous_token <> _token THEN
    DELETE FROM public.push_devices
    WHERE user_id = _uid AND token = _previous_token;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.push_devices WHERE user_id = _uid AND token = _token
  ) THEN
    SELECT count(*) INTO _active_devices
    FROM public.push_devices WHERE user_id = _uid AND active;
    IF _active_devices >= 10 THEN
      RAISE EXCEPTION 'This account has reached the active device limit';
    END IF;
  END IF;

  INSERT INTO public.push_devices (user_id, token, platform, app_version, active, updated_at, last_seen_at)
  VALUES (_uid, _token, _platform, _app_version, true, now(), now())
  ON CONFLICT (token) DO UPDATE
    SET platform = EXCLUDED.platform,
        app_version = EXCLUDED.app_version,
        active = true,
        updated_at = now(),
        last_seen_at = now()
    WHERE public.push_devices.user_id = _uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Push token is already associated with another account';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.register_push_device(text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unregister_push_device(_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  DELETE FROM public.push_devices
  WHERE user_id = auth.uid() AND token = _token;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.unregister_push_device(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(text) TO authenticated;

CREATE TABLE public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id text,
  category text NOT NULL CHECK (category IN ('like', 'match', 'message')),
  event_id text NOT NULL,
  route_data jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(route_data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (recipient_id, category, event_id)
);
CREATE INDEX notification_outbox_pending_idx
  ON public.notification_outbox (created_at, id) WHERE processed_at IS NULL;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_outbox TO service_role;

CREATE TABLE public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notification_outbox(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.push_devices(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'submitted', 'delivered', 'failed', 'suppressed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  provider_ticket text,
  submitted_at timestamptz,
  receipt_checked_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, device_id)
);
CREATE INDEX notification_deliveries_due_idx
  ON public.notification_deliveries (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX notification_deliveries_receipt_idx
  ON public.notification_deliveries (submitted_at)
  WHERE status = 'submitted' AND receipt_checked_at IS NULL;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_like_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _recipient uuid;
BEGIN
  IF NEW.kind <> 'like'
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
      AND NOT public.is_blocked_pair(NEW.from_id, NEW.to_id)
  )
  ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_like_notification() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_enqueue_like_notification
  AFTER INSERT ON public.swipes
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_like_notification();

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
  IF public.is_blocked_pair(NEW.user_a, NEW.user_b) THEN
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
          AND NOT public.is_blocked_pair(_recipient, _actor)
      )
      ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_match_notifications() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enqueue_match_notifications
  AFTER INSERT ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_match_notifications();

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
  SELECT * INTO _match FROM public.matches WHERE id = NEW.match_id;
  IF _match.id IS NULL OR public.is_blocked_pair(_match.user_a, _match.user_b) THEN
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
        AND NOT public.is_blocked_pair(_recipient, NEW.sender)
    )
    ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_message_notification() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enqueue_message_notification
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_message_notification();

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
      END
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

CREATE OR REPLACE FUNCTION public.complete_push_delivery(
  _delivery_id uuid,
  _status text,
  _provider_ticket text DEFAULT NULL,
  _error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF _status IS NULL OR _status NOT IN ('submitted', 'retry', 'failed') THEN
    RAISE EXCEPTION 'Invalid delivery status';
  END IF;
  IF _provider_ticket IS NOT NULL AND length(_provider_ticket) > 200 THEN
    RAISE EXCEPTION 'Invalid provider ticket';
  END IF;
  IF _error_code IS NOT NULL AND length(_error_code) > 80 THEN
    RAISE EXCEPTION 'Invalid provider error code';
  END IF;

  UPDATE public.notification_deliveries
  SET status = CASE
        WHEN _status = 'retry' AND attempt_count < 8 THEN 'pending'
        WHEN _status = 'retry' THEN 'failed'
        ELSE _status
      END,
      provider_ticket = CASE WHEN _status = 'submitted' THEN _provider_ticket ELSE NULL END,
      submitted_at = CASE WHEN _status = 'submitted' THEN now() ELSE NULL END,
      receipt_checked_at = NULL,
      next_attempt_at = CASE
        WHEN _status = 'retry' AND attempt_count < 8
          THEN now() + make_interval(secs => least(3600, 15 * (2 ^ least(attempt_count, 8)))::integer)
        ELSE next_attempt_at
      END,
      locked_at = NULL,
      last_error = _error_code
  WHERE id = _delivery_id AND status = 'processing';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery is not claimed or no longer available';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_push_delivery(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_push_delivery(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_push_receipt(
  _delivery_id uuid,
  _delivered boolean,
  _error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF _error_code IS NOT NULL AND length(_error_code) > 80 THEN
    RAISE EXCEPTION 'Invalid provider error code';
  END IF;
  UPDATE public.notification_deliveries
  SET status = CASE WHEN _delivered THEN 'delivered' ELSE 'failed' END,
      receipt_checked_at = now(),
      last_error = _error_code
  WHERE id = _delivery_id AND status = 'submitted';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_push_receipt(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_push_receipt(uuid, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.deactivate_push_device(_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  UPDATE public.push_devices
  SET active = false, updated_at = now()
  WHERE id = _device_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.deactivate_push_device(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_push_device(uuid) TO service_role;

COMMIT;
