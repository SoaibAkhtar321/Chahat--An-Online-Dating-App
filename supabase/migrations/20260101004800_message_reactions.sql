-- Message emoji reactions (one reaction per person per message, like WhatsApp).
--
--   * message_reactions   : (message_id, user_id) is the key, so changing a reaction replaces it. Removing a reaction
--                           sets emoji to NULL instead of deleting the row: Realtime can RLS-filter UPDATEs but not
--                           DELETEs, so this is how the partner's app learns about a removal without a leak.
--   * set_message_reaction: the only write path (no client INSERT/UPDATE/DELETE grants). Caller must be a member of the
--                           match, the message must be live and not hidden for the caller, the account must be active
--                           and not deletion-pending. Emoji are restricted to a fixed set, enforced in the database.
--   * Visibility          : members of the match can read, only while the message is not deleted for everyone.
--                           A tombstoning trigger clears the reactions of a message deleted for everyone.
--   * Realtime            : table added to the supabase_realtime publication (INSERT/UPDATE only are used by the app).
--
-- Deliberately NOT done: no push notification for reactions; no change to existing tables or policies.
BEGIN;

CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id   uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  emoji      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT message_reactions_emoji_allowed CHECK (emoji IS NULL OR emoji IN ('👍', '❤️', '😂', '😮', '😢', '🙏'))
);
CREATE INDEX IF NOT EXISTS message_reactions_match_idx ON public.message_reactions (match_id) WHERE emoji IS NOT NULL;

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.message_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.message_reactions TO authenticated;
GRANT ALL ON TABLE public.message_reactions TO service_role;

-- The messages subquery runs under the caller's own RLS, so "deleted for me" messages stay hidden here too.
DROP POLICY IF EXISTS "members read reactions" ON public.message_reactions;
CREATE POLICY "members read reactions" ON public.message_reactions FOR SELECT TO authenticated
  USING (
    public.is_match_member(match_id)
    AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id AND m.deleted_at IS NULL)
  );

-- Write path ------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_message_reaction(_message_id uuid, _emoji text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _match_id uuid;
  _deleted_at timestamptz;
  _clean text := nullif(btrim(coalesce(_emoji, '')), '');
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _message_id IS NULL THEN RAISE EXCEPTION 'Message ID required'; END IF;
  IF NOT public.account_not_deletion_pending() THEN
    RETURN jsonb_build_object('success', false, 'error', 'account_deletion_pending');
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid::text AND status <> 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'account_suspended');
  END IF;

  SELECT m.match_id, m.deleted_at INTO _match_id, _deleted_at FROM public.messages m WHERE m.id = _message_id;
  IF _match_id IS NULL
     OR _deleted_at IS NOT NULL
     OR NOT public.is_match_member(_match_id)
     OR public.message_hidden_for_caller(_message_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'message_not_found');
  END IF;

  IF _clean IS NOT NULL AND _clean NOT IN ('👍', '❤️', '😂', '😮', '😢', '🙏') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_reaction');
  END IF;

  IF _clean IS NULL THEN
    UPDATE public.message_reactions
       SET emoji = NULL, updated_at = now()
     WHERE message_id = _message_id AND user_id = _uid AND emoji IS NOT NULL;
  ELSE
    INSERT INTO public.message_reactions (message_id, user_id, match_id, emoji)
    VALUES (_message_id, _uid, _match_id, _clean)
    ON CONFLICT (message_id, user_id) DO UPDATE
      SET emoji = EXCLUDED.emoji, updated_at = now()
      WHERE public.message_reactions.emoji IS DISTINCT FROM EXCLUDED.emoji;
  END IF;

  RETURN jsonb_build_object('success', true, 'emoji', _clean);
END $$;

REVOKE EXECUTE ON FUNCTION public.set_message_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_message_reaction(uuid, text) TO authenticated, service_role;

-- A message deleted for everyone loses its reactions (the rows stay, emptied, so no Realtime DELETE is emitted) ------------
CREATE OR REPLACE FUNCTION public.clear_reactions_on_tombstone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.message_reactions SET emoji = NULL, updated_at = now() WHERE message_id = NEW.id AND emoji IS NOT NULL;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.clear_reactions_on_tombstone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_clear_reactions ON public.messages;
CREATE TRIGGER messages_clear_reactions AFTER UPDATE OF deleted_at ON public.messages
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.clear_reactions_on_tombstone();

-- Realtime ----------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;
END $$;

COMMIT;
