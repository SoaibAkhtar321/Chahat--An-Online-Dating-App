-- 20260101005900_read_receipt_privacy.sql
-- Read receipts are a Plus/VIP feature: a SENDER may learn when the other person read their message only on
-- an active Plus or VIP plan. get_match_messages already masked that, but messages.read_at was still readable
-- by every chat member through the table itself (PostgREST select, and Realtime row payloads), so any
-- modified client saw "read" without paying. Realtime only emits columns the subscriber may SELECT
-- (realtime.apply_rls checks has_column_privilege), so removing column access closes both paths.
--
--   * authenticated keeps SELECT on every messages column EXCEPT read_at (table-level SELECT is replaced by
--     an explicit column grant). RLS on rows is unchanged.
--   * Reading read state now goes through SECURITY DEFINER functions that apply the plan rule:
--       get_match_messages          (unchanged: sender sees read_at only on Plus/VIP)
--       get_chat_list_state(uuid[]) (new: unread count for me + "last outgoing message read", masked the same way)
--   * Marking read goes through mark_chat_read(uuid) (new). Recipients' own read state (unread counts) keeps
--     working for every plan; it is not a receipt about the other person.
-- NOTE for future migrations: a column added to public.messages is NOT visible to the app until it is added
-- to the column grant (see the DO block below; re-run its pattern).
-- Forward-only. Old app builds lose unread badges / mark-read until updated (they selected read_at directly).
BEGIN;

-- ---------- 1. Column-level read access ----------
REVOKE SELECT ON public.messages FROM authenticated, anon;
DO $$
DECLARE _cols text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO _cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.messages'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname <> 'read_at';
  EXECUTE format('GRANT SELECT (%s) ON public.messages TO authenticated', _cols);
END $$;

-- ---------- 2. Mark my incoming messages of a chat as read ----------
CREATE OR REPLACE FUNCTION public.mark_chat_read(_match_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
  _count integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF _match_id IS NULL OR NOT public.is_match_member(_match_id) THEN RAISE EXCEPTION 'Not a member of this match'; END IF;

  UPDATE public.messages m
     SET read_at = now()
   WHERE m.match_id = _match_id
     AND m.sender <> _uid
     AND m.read_at IS NULL
     AND m.deleted_at IS NULL;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END
$$;
REVOKE EXECUTE ON FUNCTION public.mark_chat_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_chat_read(uuid) TO authenticated;

-- ---------- 3. Chat list state: unread counts and (masked) last-message receipt ----------
CREATE OR REPLACE FUNCTION public.get_chat_list_state(_match_ids uuid[] DEFAULT NULL)
RETURNS TABLE (match_id uuid, unread_count integer, last_message_id uuid, last_message_read boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _receipts boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF _match_ids IS NOT NULL AND cardinality(_match_ids) > 200 THEN RAISE EXCEPTION 'Too many matches'; END IF;
  _receipts := public.get_active_subscription_tier(_uid::text) IN ('plus', 'vip');

  RETURN QUERY
  WITH mine AS (
    SELECT mt.id
    FROM public.matches mt
    WHERE _uid::text IN (mt.user_a, mt.user_b)
      AND NOT public.is_blocked_pair(mt.user_a, mt.user_b)
      AND (_match_ids IS NULL OR mt.id = ANY (_match_ids))
  )
  SELECT
    mine.id,
    (SELECT count(*)::integer FROM public.messages m
      WHERE m.match_id = mine.id AND m.sender <> _uid::text AND m.read_at IS NULL AND m.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.message_user_deletions d WHERE d.message_id = m.id AND d.user_id = _uid)),
    last.id,
    CASE WHEN last.id IS NULL THEN NULL
         WHEN last.sender <> _uid::text THEN last.read_at IS NOT NULL   -- my own reading: always visible
         WHEN _receipts THEN last.read_at IS NOT NULL                   -- the other person's reading: Plus/VIP
         ELSE NULL END
  FROM mine
  LEFT JOIN LATERAL (
    SELECT m.id, m.sender, m.read_at FROM public.messages m
    WHERE m.match_id = mine.id
      AND NOT EXISTS (SELECT 1 FROM public.message_user_deletions d WHERE d.message_id = m.id AND d.user_id = _uid)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) last ON true;
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_chat_list_state(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_list_state(uuid[]) TO authenticated;

-- Unread counting reads (match_id, sender, read_at); this keeps it an index scan per chat.
CREATE INDEX IF NOT EXISTS messages_match_unread_idx ON public.messages (match_id) WHERE read_at IS NULL AND deleted_at IS NULL;

COMMIT;
