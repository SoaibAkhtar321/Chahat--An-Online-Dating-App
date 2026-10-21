-- Chat message delivery status (WhatsApp-style ticks): sent -> delivered -> read.
--
--   * messages.delivered_at : set once, by the server clock, when the recipient's app has received the message.
--                             Reading a message also implies delivery (read_at set => delivered_at set).
--   * mark_messages_delivered(_match_id) : recipient-only RPC; marks that match's (or, with NULL, all of the caller's
--                             matches') undelivered incoming messages as delivered.
--   * get_match_messages    : same shape + delivered_at. read_at stays masked for non-Plus/VIP senders (unchanged).
--
-- Deliberately NOT done: no change to the read-receipt entitlement rule; no change to RLS policies (the existing
-- "recipient marks read" UPDATE policy already limits updates to the recipient of the message).
BEGIN;

-- 1. Column + backfill of already-read rows ----------------------------------------------------------------------------
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

UPDATE public.messages SET delivered_at = read_at WHERE read_at IS NOT NULL AND delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS messages_undelivered_idx
  ON public.messages (match_id)
  WHERE delivered_at IS NULL AND deleted_at IS NULL;

-- 2. Consistency guard: delivered_at is write-once, server-timed for clients, and implied by read_at ------------------
-- Named so it fires before messages_guard (triggers run alphabetically); messages_guard leaves this column alone.
CREATE OR REPLACE FUNCTION public.messages_delivery_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.delivered_at IS NOT NULL THEN
    NEW.delivered_at := OLD.delivered_at;
  ELSIF NEW.delivered_at IS NOT NULL AND current_user IN ('authenticated', 'anon') THEN
    NEW.delivered_at := now();
  END IF;

  IF NEW.read_at IS NOT NULL AND NEW.delivered_at IS NULL THEN
    NEW.delivered_at := CASE WHEN current_user IN ('authenticated', 'anon') THEN now() ELSE NEW.read_at END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_delivery_guard ON public.messages;
CREATE TRIGGER messages_delivery_guard BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_delivery_guard();

-- 3. Recipient marks incoming messages as delivered ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_messages_delivered(_match_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid := auth.uid();
  _count integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  UPDATE public.messages m
     SET delivered_at = now()
   WHERE m.delivered_at IS NULL
     AND m.deleted_at IS NULL
     AND m.sender <> _uid::text
     AND (_match_id IS NULL OR m.match_id = _match_id)
     AND EXISTS (
       SELECT 1 FROM public.matches mt
       WHERE mt.id = m.match_id AND _uid::text IN (mt.user_a, mt.user_b)
     );

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

REVOKE EXECUTE ON FUNCTION public.mark_messages_delivered(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_delivered(uuid) TO authenticated, service_role;

-- 4. get_match_messages: copied from 20260101004200 + delivered_at -----------------------------------------------------
DROP FUNCTION IF EXISTS public.get_match_messages(uuid, integer);
CREATE FUNCTION public.get_match_messages(_match_id uuid, _limit integer DEFAULT 50)
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
  read_at timestamptz,
  deleted_at timestamptz,
  delivered_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _my_id text := auth.uid()::text;
  _tier text;
BEGIN
  IF _my_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.is_match_member(_match_id) THEN RAISE EXCEPTION 'Not a member of this match'; END IF;

  _tier := public.get_active_subscription_tier(_my_id);

  RETURN QUERY
  SELECT * FROM (
    SELECT
      m.id,
      m.match_id,
      m.sender,
      CASE WHEN m.deleted_at IS NOT NULL THEN ''::text ELSE m.body END,
      -- A consumed View Once image is never returned to the recipient; tombstones never return media.
      CASE
        WHEN m.deleted_at IS NOT NULL THEN NULL
        WHEN m.is_view_once AND m.viewed_at IS NOT NULL AND m.sender <> _my_id THEN NULL
        ELSE m.image_path
      END AS image_path,
      CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.audio_path END AS audio_path,
      CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.audio_duration_sec END AS audio_duration_sec,
      m.message_type,
      m.is_view_once,
      m.viewed_at,
      m.created_at,
      CASE
        WHEN m.sender = _my_id AND _tier NOT IN ('plus', 'vip') THEN NULL
        ELSE m.read_at
      END AS read_at,
      m.deleted_at,
      -- Delivery is not a premium signal: only read receipts stay masked for non-Plus/VIP senders.
      m.delivered_at
    FROM public.messages m
    WHERE m.match_id = _match_id
      AND NOT EXISTS (
        SELECT 1 FROM public.message_user_deletions d
        WHERE d.message_id = m.id AND d.user_id = auth.uid()
      )
    ORDER BY m.created_at DESC
    LIMIT greatest(1, least(coalesce(_limit, 50), 100))
  ) latest
  ORDER BY latest.created_at ASC;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_match_messages(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_messages(uuid, integer) TO authenticated, service_role;

COMMIT;
