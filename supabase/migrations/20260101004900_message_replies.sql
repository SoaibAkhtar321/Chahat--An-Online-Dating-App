-- Reply to a specific message (WhatsApp-style quoted preview).
--
--   * messages.reply_to_id : the message being replied to. Set only on INSERT, never changed by a client afterwards.
--                            ON DELETE SET NULL, so a hard delete of the original (match removal cascades anyway) never
--                            blocks anything.
--   * messages_reply_validate (BEFORE INSERT) : the original must be in the SAME match, must not be deleted for
--                            everyone, and must not be hidden ("deleted for me") for the sender. Enforced for every
--                            client write path; no RLS policy change is needed.
--   * messages_reply_guard (BEFORE UPDATE) : clients cannot rewrite reply_to_id (the recipient has an UPDATE policy
--                            for read receipts, so the column must be protected).
--   * get_match_messages   : same shape + reply_to_id and a server-built preview of the original (sender, a short text
--                            snippet, kind, unavailable flag). The preview is computed here, not by the client, so it
--                            respects "deleted for me" / "deleted for everyone", never returns media paths, never returns
--                            the text of a view-once photo, and works even when the original is older than the page.
--
-- Deliberately NOT done: no change to RLS policies, no change to delete-for-everyone (a tombstoned reply simply returns
-- no preview), no push-notification change (the push text is the reply's own text).
BEGIN;

-- 1. Column + index -----------------------------------------------------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_reply_to_idx ON public.messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_reply_not_self;
ALTER TABLE public.messages ADD CONSTRAINT messages_reply_not_self CHECK (reply_to_id IS NULL OR reply_to_id <> id);

-- 2. A reply must point at a visible message of the same chat ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_reply_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _target_match uuid;
  _target_deleted timestamptz;
BEGIN
  IF NEW.reply_to_id IS NULL THEN RETURN NEW; END IF;

  SELECT m.match_id, m.deleted_at INTO _target_match, _target_deleted FROM public.messages m WHERE m.id = NEW.reply_to_id;

  IF _target_match IS NULL OR _target_match IS DISTINCT FROM NEW.match_id OR _target_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'reply_target_unavailable' USING ERRCODE = 'check_violation';
  END IF;

  -- "Deleted for me" by the sender: they cannot see that message any more, so they cannot reply to it.
  IF EXISTS (
    SELECT 1 FROM public.message_user_deletions d
    WHERE d.message_id = NEW.reply_to_id AND d.user_id::text = NEW.sender
  ) THEN
    RAISE EXCEPTION 'reply_target_unavailable' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.messages_reply_validate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_reply_validate ON public.messages;
CREATE TRIGGER messages_reply_validate BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_reply_validate();

-- 3. reply_to_id is write-once for clients ----------------------------------------------------------------------------
-- Client roles can never change it. The FK's own ON DELETE SET NULL runs as the table owner, so it still works.
CREATE OR REPLACE FUNCTION public.messages_reply_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.reply_to_id := OLD.reply_to_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_reply_guard ON public.messages;
CREATE TRIGGER messages_reply_guard BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_reply_guard();

-- 4. get_match_messages: copied from 20260101004700_message_delivery_status + reply fields -----------------------------
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
  delivered_at timestamptz,
  reply_to_id uuid,
  reply_sender text,
  reply_body text,
  reply_kind text,
  reply_unavailable boolean
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
      m.delivered_at,
      -- Reply preview. A deleted reply carries none. The original is "unavailable" when it is gone, deleted for
      -- everyone, or hidden for me; then no sender/text/kind is returned at all.
      CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.reply_to_id END AS reply_to_id,
      CASE WHEN m.deleted_at IS NULL AND r.id IS NOT NULL AND r.deleted_at IS NULL AND rd.message_id IS NULL
           THEN r.sender END AS reply_sender,
      CASE WHEN m.deleted_at IS NULL AND r.id IS NOT NULL AND r.deleted_at IS NULL AND rd.message_id IS NULL
                AND r.image_path IS NULL AND r.audio_path IS NULL AND coalesce(r.message_type, 'text') = 'text'
           THEN left(r.body, 120) END AS reply_body,
      CASE WHEN m.deleted_at IS NULL AND r.id IS NOT NULL AND r.deleted_at IS NULL AND rd.message_id IS NULL
           THEN CASE
                  WHEN r.audio_path IS NOT NULL OR r.message_type = 'voice' THEN 'voice'
                  WHEN r.image_path IS NOT NULL OR r.message_type = 'image' THEN 'image'
                  ELSE 'text'
                END END AS reply_kind,
      CASE WHEN m.deleted_at IS NULL AND m.reply_to_id IS NOT NULL
                AND (r.id IS NULL OR r.deleted_at IS NOT NULL OR rd.message_id IS NOT NULL)
           THEN true ELSE false END AS reply_unavailable
    FROM public.messages m
    LEFT JOIN public.messages r
      ON r.id = m.reply_to_id AND r.match_id = m.match_id
    LEFT JOIN public.message_user_deletions rd
      ON rd.message_id = r.id AND rd.user_id = auth.uid()
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
