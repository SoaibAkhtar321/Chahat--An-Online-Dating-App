-- 20260101004200_message_deletion.sql
-- Phase 3A: database foundation for message deletion. STAGED FILE: do not apply to the live Supabase project without review.
--
--   * Delete for me       : per-user hide row (message_user_deletions). The other participant is unaffected; media stays.
--   * Delete for everyone : sender-only. The row stays as a TOMBSTONE (deleted_at set, body/media/duration scrubbed,
--                           message_type reset to 'text'); the scrub is irreversible. Chat media paths are queued in
--                           chat_media_cleanup_queue in the SAME transaction.
--   * Visibility          : the messages SELECT policy (direct queries AND Realtime) hides "deleted for me" rows;
--                           get_match_messages, open_view_once_message and the push display helpers honour both kinds.
--   * Media               : the chat Storage SELECT policy denies any queued path immediately (no new signed URLs);
--                           a service-role worker removes the object through the Storage API with durable retry/backoff.
--
-- Deliberately NOT done: no REPLICA IDENTITY FULL (Realtime 'old' records must not carry content); the hide table is
-- NOT added to the Realtime publication (Realtime cannot RLS-filter DELETE events); no time limit on Delete for
-- everyone and no retention of scrubbed content (open product/legal decisions, see the Phase 3A report).
BEGIN;

-- 1. Tombstone column + consistency guard ---------------------------------------------------------------------------
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Enforced for every writer (service_role included): a tombstone never carries content.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_tombstone_has_no_content;
ALTER TABLE public.messages ADD CONSTRAINT messages_tombstone_has_no_content
  CHECK (deleted_at IS NULL OR (body = '' AND image_path IS NULL AND audio_path IS NULL AND audio_duration_sec IS NULL));

-- 2. Delete-for-me table (no client write access; RPC only) -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_user_deletions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_user_deletions_user_idx ON public.message_user_deletions (user_id);
ALTER TABLE public.message_user_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.message_user_deletions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.message_user_deletions TO service_role;

CREATE OR REPLACE FUNCTION public.message_hidden_for_caller(_message_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.message_user_deletions d
       WHERE d.message_id = _message_id AND d.user_id = auth.uid()
     )
$$;
REVOKE EXECUTE ON FUNCTION public.message_hidden_for_caller(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_hidden_for_caller(uuid) TO authenticated, service_role;

-- 3. Direct reads + Realtime: hide "deleted for me" rows ---------------------------------------------------------------
DROP POLICY IF EXISTS "members read messages" ON public.messages;
CREATE POLICY "members read messages" ON public.messages FOR SELECT TO authenticated
  USING (public.is_match_member(match_id) AND NOT public.message_hidden_for_caller(id));

-- 4. Guard: clients can never touch tombstone columns; only the trusted RPC path may tombstone ------------------------
-- The exception needs BOTH a non-client current_user (SECURITY DEFINER owner / service_role; clients run as
-- 'authenticated'/'anon') AND the transaction-local marker naming this exact row, which only
-- delete_message_for_everyone() sets. Everything else is restored exactly as in 20260101002500.
CREATE OR REPLACE FUNCTION public.messages_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  _tombstone boolean := false;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
     AND current_user NOT IN ('authenticated', 'anon')
     AND coalesce(current_setting('app.message_tombstone', true), '') = OLD.id::text THEN
    _tombstone := true;
  END IF;

  NEW.id := OLD.id;
  NEW.match_id := OLD.match_id;
  NEW.sender := OLD.sender;
  NEW.created_at := OLD.created_at;
  IF NOT _tombstone THEN
    NEW.body := OLD.body;
    NEW.image_path := OLD.image_path;
    NEW.audio_path := OLD.audio_path;
    NEW.audio_duration_sec := OLD.audio_duration_sec;
    NEW.message_type := OLD.message_type;
    NEW.deleted_at := OLD.deleted_at;
  END IF;
  RETURN NEW;
END $$;

-- 5. get_match_messages: same shape + deleted_at; hidden rows are excluded BEFORE the newest-N limit ------------------
-- Return type changes, so the old signature is dropped (never left as a second overload).
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
  deleted_at timestamptz
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
      m.deleted_at
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

-- 6. open_view_once_message: copied from 20260101002800 + refuse deleted / hidden messages ------------------------------
CREATE OR REPLACE FUNCTION public.open_view_once_message(_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _msg public.messages;
  _match public.matches;
  _is_recipient boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _message_id IS NULL THEN RAISE EXCEPTION 'Message ID required'; END IF;

  SELECT * INTO _msg FROM public.messages WHERE id = _message_id FOR UPDATE;
  IF _msg.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'message_not_found');
  END IF;

  SELECT * INTO _match FROM public.matches WHERE id = _msg.match_id;
  IF _match.id IS NULL OR _uid::text NOT IN (_match.user_a, _match.user_b) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- Phase 3A: deleted-for-everyone and deleted-for-me messages are never served or consumed.
  IF _msg.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'message_deleted');
  END IF;
  IF EXISTS (SELECT 1 FROM public.message_user_deletions d WHERE d.message_id = _msg.id AND d.user_id = _uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'message_not_found');
  END IF;

  _is_recipient := (_uid::text <> _msg.sender);

  IF NOT _msg.is_view_once THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_view_once', false,
      'image_path', _msg.image_path
    );
  END IF;

  IF NOT _is_recipient THEN
    RETURN jsonb_build_object(
      'success', true,
      'is_view_once', true,
      'is_sender', true,
      'viewed_at', _msg.viewed_at
    );
  END IF;

  IF _msg.viewed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_viewed',
      'message', 'This photo has already been viewed.',
      'viewed_at', _msg.viewed_at
    );
  END IF;

  IF _msg.expires_at IS NOT NULL AND _msg.expires_at < now() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'expired',
      'message', 'This photo has expired.'
    );
  END IF;

  UPDATE public.messages
  SET viewed_at = now(),
      viewed_by = _uid
  WHERE id = _msg.id;

  RETURN jsonb_build_object(
    'success', true,
    'is_view_once', true,
    'image_path', _msg.image_path,
    'viewed_at', now()
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.open_view_once_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_view_once_message(uuid) TO authenticated, service_role;

-- 7. Durable media cleanup queue ----------------------------------------------------------------------------------------
-- Holds only (match, message, object path): no user identity, so it survives account deletion without personal data and
-- there is deliberately NO foreign key (the queue must outlive the message/match rows).
CREATE TABLE IF NOT EXISTS public.chat_media_cleanup_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL DEFAULT 'chat' CHECK (bucket = 'chat'),
  object_path text NOT NULL,
  match_id uuid NOT NULL,
  message_id uuid NOT NULL,
  reason text NOT NULL DEFAULT 'delete_for_everyone' CHECK (reason = 'delete_for_everyone'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT chat_media_cleanup_path_valid CHECK (public.is_valid_chat_media_path(object_path, match_id)),
  CONSTRAINT chat_media_cleanup_unique_object UNIQUE (bucket, object_path)
);
CREATE INDEX IF NOT EXISTS chat_media_cleanup_due_idx
  ON public.chat_media_cleanup_queue (status, next_attempt_at) WHERE status <> 'done';
ALTER TABLE public.chat_media_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_media_cleanup_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.chat_media_cleanup_queue TO service_role;

-- Queued paths are denied to every client immediately (also after the object is gone, so a path can't be reused).
CREATE OR REPLACE FUNCTION public.chat_media_pending_deletion(_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_media_cleanup_queue q WHERE q.bucket = 'chat' AND q.object_path = _name
  )
$$;
REVOKE EXECUTE ON FUNCTION public.chat_media_pending_deletion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_media_pending_deletion(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "chat read members" ON storage.objects;
CREATE POLICY "chat read members" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat'
    AND public.chat_folder_member((storage.foldername(name))[1])
    AND NOT public.chat_media_pending_deletion(name)
  );

-- 8. Client RPCs ----------------------------------------------------------------------------------------------------------
-- Result codes (jsonb, success=false unless noted): message_not_found (unknown OR not a participant, deliberately
-- indistinguishable), account_deletion_pending, account_not_active, forbidden (participant but not the sender).
CREATE OR REPLACE FUNCTION public.delete_message_for_me(_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _match_id uuid;
  _rows integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _message_id IS NULL THEN RAISE EXCEPTION 'Message ID required'; END IF;
  IF NOT public.account_not_deletion_pending() THEN
    RETURN jsonb_build_object('success', false, 'error', 'account_deletion_pending');
  END IF;

  SELECT m.match_id INTO _match_id FROM public.messages m WHERE m.id = _message_id;
  IF _match_id IS NULL OR NOT public.is_match_member(_match_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'message_not_found');
  END IF;

  INSERT INTO public.message_user_deletions (message_id, user_id)
  VALUES (_message_id, _uid)
  ON CONFLICT (message_id, user_id) DO NOTHING;
  GET DIAGNOSTICS _rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'status', CASE WHEN _rows = 1 THEN 'deleted_for_me' ELSE 'already_deleted' END,
    'message_id', _message_id
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_message_for_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_message_for_me(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_message_for_everyone(_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _msg public.messages;
  _deleted_at timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _message_id IS NULL THEN RAISE EXCEPTION 'Message ID required'; END IF;
  IF NOT public.account_not_deletion_pending() THEN
    RETURN jsonb_build_object('success', false, 'error', 'account_deletion_pending');
  END IF;

  SELECT * INTO _msg FROM public.messages WHERE id = _message_id FOR UPDATE;
  IF _msg.id IS NULL OR NOT public.is_match_member(_msg.match_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'message_not_found');
  END IF;
  IF _msg.sender <> _uid::text THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  -- Same rule as sending: suspended members cannot use this to erase what they sent.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid::text AND p.status = 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'account_not_active');
  END IF;

  IF _msg.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'status', 'already_deleted',
      'message_id', _msg.id, 'deleted_at', _msg.deleted_at);
  END IF;

  -- Queue first, tombstone second, one transaction: either both are committed or neither is.
  INSERT INTO public.chat_media_cleanup_queue (object_path, match_id, message_id)
  SELECT path, _msg.match_id, _msg.id
  FROM unnest(ARRAY[_msg.image_path, _msg.audio_path]) AS p(path)
  WHERE path IS NOT NULL
  ON CONFLICT (bucket, object_path) DO UPDATE
    SET status = CASE WHEN chat_media_cleanup_queue.status = 'done' THEN 'pending' ELSE chat_media_cleanup_queue.status END,
        next_attempt_at = CASE WHEN chat_media_cleanup_queue.status = 'done' THEN now() ELSE chat_media_cleanup_queue.next_attempt_at END;

  _deleted_at := now();
  PERFORM set_config('app.message_tombstone', _msg.id::text, true);
  UPDATE public.messages
  SET body = '', image_path = NULL, audio_path = NULL, audio_duration_sec = NULL,
      message_type = 'text', deleted_at = _deleted_at
  WHERE id = _msg.id;
  PERFORM set_config('app.message_tombstone', '', true);

  RETURN jsonb_build_object('success', true, 'status', 'deleted',
    'message_id', _msg.id, 'deleted_at', _deleted_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_message_for_everyone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_message_for_everyone(uuid) TO authenticated, service_role;

-- 9. Cleanup worker RPCs (service_role only) -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_chat_media_cleanup(_limit integer DEFAULT 25)
RETURNS TABLE (id uuid, bucket text, object_path text, attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  RETURN QUERY
  WITH due AS (
    SELECT q.id
    FROM public.chat_media_cleanup_queue q
    WHERE (q.status = 'pending' AND q.next_attempt_at <= now())
       OR (q.status = 'processing' AND q.locked_at < now() - interval '10 minutes')
    ORDER BY q.next_attempt_at, q.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(coalesce(_limit, 25), 1), 100)
  )
  UPDATE public.chat_media_cleanup_queue q
  SET status = 'processing', attempt_count = q.attempt_count + 1, locked_at = now()
  FROM due
  WHERE q.id = due.id
  RETURNING q.id, q.bucket, q.object_path, q.attempt_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_chat_media_cleanup(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chat_media_cleanup(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_chat_media_cleanup(_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _n integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  UPDATE public.chat_media_cleanup_queue
  SET status = 'done', completed_at = now(), locked_at = NULL, last_error = NULL
  WHERE id = ANY(coalesce(_ids, ARRAY[]::uuid[])) AND status <> 'done';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_chat_media_cleanup(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_chat_media_cleanup(uuid[]) TO service_role;

-- Retry forever with capped exponential backoff (1, 2, 4 ... 60 minutes): content is already denied, so a stuck row is
-- a storage-hygiene problem to alert on (attempt_count / last_error), not a reason to give up.
CREATE OR REPLACE FUNCTION public.fail_chat_media_cleanup(_id uuid, _error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  UPDATE public.chat_media_cleanup_queue q
  SET status = 'pending', locked_at = NULL,
      last_error = left(coalesce(_error, 'unknown'), 200),
      next_attempt_at = now() + least(interval '60 minutes', interval '1 minute' * power(2, least(q.attempt_count, 6)))
  WHERE q.id = _id AND q.status = 'processing';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fail_chat_media_cleanup(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_chat_media_cleanup(uuid, text) TO service_role;

-- 10. Push: a deleted message is never pushed or quoted --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notification_source_exists(_category text, _event_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE _category
    WHEN 'match'   THEN EXISTS (SELECT 1 FROM public.matches  WHERE id::text = _event_id)
    WHEN 'message' THEN EXISTS (SELECT 1 FROM public.messages WHERE id::text = _event_id AND deleted_at IS NULL)
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
    CASE
      WHEN o.category IN ('match', 'message')
       AND coalesce(pref.lock_screen_details, 'name') IN ('name', 'preview')
      THEN nullif(left(split_part(btrim(regexp_replace(actor.name, '[[:cntrl:]]+', ' ', 'g')), ' ', 1), 20), '')
    END,
    -- Preview only when the recipient opted in; media and view-once content is never quoted. Phase 3A: never for a
    -- message deleted for everyone, nor one the recipient deleted for themselves.
    CASE
      WHEN o.category = 'message'
       AND coalesce(pref.lock_screen_details, 'name') = 'preview'
       AND m.id IS NOT NULL
       AND m.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.message_user_deletions d
         WHERE d.message_id = m.id AND d.user_id = o.recipient_id
       )
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

COMMIT;
