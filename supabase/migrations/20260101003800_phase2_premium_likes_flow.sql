-- 20260101003800_phase2_premium_likes_flow.sql
-- Chahat Phase 2 (Premium likes notification flow + security). Reuses the existing outbox ->
-- dispatch-push pipeline, user_subscriptions and get_active_subscription_tier(); no new tables.
--   1. _like_is_valid(): the ONE rule for "a like that may be shown, counted or pushed".
--   2. get_my_likes_access(): authoritative entitlement; the count is returned to eligible members only.
--      The legacy get_incoming_likes_count() (previously open to every member) is gated the same way.
--   3. get_received_likes(): the ONLY path to liker identities; raises upgrade_required for free members.
--   4. The raw "paid members read received likes" RLS policy on swipes is dropped (no direct reads).
--   5. enqueue_like_notification(): uses the shared rule (no push for reciprocal / answered likes).
--   6. claim_push_deliveries(): suppresses like pushes that became invalid before delivery.
BEGIN;

-- ---------- 1. Shared validity rule (internal only) ----------
CREATE OR REPLACE FUNCTION public._like_is_valid(_from text, _to text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.swipes s
    JOIN public.profiles liker ON liker.id = s.from_id
    JOIN public.profiles target ON target.id = s.to_id
    WHERE s.from_id = _from AND s.to_id = _to
      AND s.kind IN ('like', 'priority')
      -- non-mutual and unanswered: the recipient has not liked back or passed
      AND NOT EXISTS (SELECT 1 FROM public.swipes r WHERE r.from_id = s.to_id AND r.to_id = s.from_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.user_a = least(s.from_id, s.to_id) AND m.user_b = greatest(s.from_id, s.to_id)
      )
      AND NOT public._pair_blocked(s.from_id, s.to_id)
      AND liker.is_demo = false AND liker.status = 'active' AND liker.onboarded
      AND target.is_demo = false AND target.status = 'active' AND target.onboarded
  )
$$;
REVOKE EXECUTE ON FUNCTION public._like_is_valid(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------- 2. Authoritative access check (count for eligible members only, never identities) ----------
CREATE OR REPLACE FUNCTION public.get_my_likes_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
  _count integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  -- Free members learn only that they are not eligible: no count, no hint that likes exist.
  IF public.get_active_subscription_tier(_uid) NOT IN ('premium', 'plus', 'vip') THEN
    RETURN jsonb_build_object('eligible', false);
  END IF;
  SELECT count(*)::integer INTO _count
  FROM public.swipes s
  WHERE s.to_id = _uid AND public._like_is_valid(s.from_id, s.to_id);
  RETURN jsonb_build_object('eligible', true, 'count', coalesce(_count, 0));
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_likes_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_likes_access() TO authenticated;

-- Legacy count RPC (migration ...000700 granted it to every authenticated member): same gate, same rule.
CREATE OR REPLACE FUNCTION public.get_incoming_likes_count()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF public.get_active_subscription_tier(_uid) NOT IN ('premium', 'plus', 'vip') THEN
    RAISE EXCEPTION 'upgrade_required' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*)::integer FROM public.swipes s
          WHERE s.to_id = _uid AND public._like_is_valid(s.from_id, s.to_id));
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_incoming_likes_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_incoming_likes_count() TO authenticated, service_role;

-- ---------- 3. The only path to liker identities ----------
CREATE OR REPLACE FUNCTION public.get_received_likes(
  _limit integer DEFAULT 50,
  _before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id text, name text, age integer, city text, photos jsonb, kind text, liked_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  -- Entitlement is decided here from user_subscriptions only; no client flag is ever consulted.
  IF public.get_active_subscription_tier(_uid) NOT IN ('premium', 'plus', 'vip') THEN
    RAISE EXCEPTION 'upgrade_required' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit < 1 OR _limit > 100 THEN
    RAISE EXCEPTION 'Invalid limit';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name,
         CASE WHEN p.dob IS NULL THEN NULL ELSE date_part('year', age(p.dob))::integer END,
         p.city,
         public.public_photos(p.id, p.photos),
         s.kind, s.created_at
  FROM public.swipes s
  JOIN public.profiles p ON p.id = s.from_id
  WHERE s.to_id = _uid
    AND public._like_is_valid(s.from_id, s.to_id)
    AND (_before IS NULL OR s.created_at < _before)
  ORDER BY (s.kind = 'priority') DESC, s.created_at DESC, p.id
  LIMIT _limit;
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_received_likes(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_received_likes(integer, timestamptz) TO authenticated;

-- ---------- 4. No direct client reads of received likes ----------
DROP POLICY IF EXISTS "paid members read received likes" ON public.swipes;

-- ---------- 5. Like trigger: shared rule, reciprocal/answered likes never notify ----------
CREATE OR REPLACE FUNCTION public.enqueue_like_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.kind NOT IN ('like', 'priority')
     OR NEW.from_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR NEW.to_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR NOT public._like_is_valid(NEW.from_id, NEW.to_id) THEN
    RETURN NEW;
  END IF;
  -- event_id is deterministic per pair, so retries / replays hit the unique key and do nothing.
  INSERT INTO public.notification_outbox (recipient_id, actor_id, category, event_id)
  VALUES (NEW.to_id::uuid, NEW.from_id, 'like', NEW.from_id || ':' || NEW.to_id)
  ON CONFLICT (recipient_id, category, event_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_like_notification() FROM PUBLIC, anon, authenticated;

-- ---------- 6. Claim: suppress like pushes that are no longer valid ----------
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
