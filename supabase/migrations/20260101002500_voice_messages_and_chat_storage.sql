-- 20260101002500_voice_messages_and_chat_storage.sql
-- Phase 5: Secure Voice Messages, Storage Bucket Audio MIME Types, and Access Control.
--
-- Features:
--   1. Storage: Update 'chat' bucket allowed MIME types to include audio (m4a, mp4, aac, webm, ogg, x-m4a).
--   2. Messages table: Add audio_path, audio_duration_sec, and message_type columns with checks.
--   3. Hardened RLS: Update 'members send messages' INSERT policy to permit voice notes only for match members.
--   4. Update trigger guard: Prevent tampering with audio_path, audio_duration_sec, and message_type on UPDATE.
--   5. RPC get_match_messages: Return audio columns and message_type to authorized participants.
--   6. Storage delete policy: Allow match members to delete abandoned/failed uploads in their match chat folder.

-- ---------- 1. Storage bucket allowed MIME types ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat',
  'chat',
  false,
  5242880,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/m4a',
    'audio/mp4',
    'audio/aac',
    'audio/mpeg',
    'audio/webm',
    'audio/ogg',
    'audio/x-m4a'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Allow match members to delete abandoned or failed uploads within their match folder
DROP POLICY IF EXISTS "chat delete members" ON storage.objects;
CREATE POLICY "chat delete members" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chat' AND public.chat_folder_member((storage.foldername(name))[1]));

-- ---------- 2. Messages table schema extensions ----------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS audio_path text,
  ADD COLUMN IF NOT EXISTS audio_duration_sec integer CHECK (
    audio_duration_sec IS NULL OR (audio_duration_sec > 0 AND audio_duration_sec <= 300)
  ),
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text' CHECK (
    message_type IN ('text', 'image', 'voice', 'system')
  );

CREATE INDEX IF NOT EXISTS messages_match_type_idx ON public.messages (match_id, message_type);

-- ---------- 3. Hardened RLS INSERT policy ----------
-- Media paths must be exactly "<this match id>/<single safe file name>".
-- Rejects other matches' folders, nested folders, leading "/", "..", backslashes,
-- empty names and anything outside [A-Za-z0-9._-].
CREATE OR REPLACE FUNCTION public.is_valid_chat_media_path(_path text, _match_id uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT _path IS NOT NULL
     AND _match_id IS NOT NULL
     AND _path ~ ('^' || _match_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$')
     AND position('..' in _path) = 0
$$;
GRANT EXECUTE ON FUNCTION public.is_valid_chat_media_path(text, uuid) TO authenticated, service_role;

-- Defense in depth: enforced for every writer (including service_role), not only via RLS.
-- NOT VALID: new/updated rows are checked; existing rows are not scanned during deploy.
-- Audit existing rows, then run: ALTER TABLE public.messages VALIDATE CONSTRAINT <name>;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_image_path_in_match_folder;
ALTER TABLE public.messages ADD CONSTRAINT messages_image_path_in_match_folder
  CHECK (image_path IS NULL OR public.is_valid_chat_media_path(image_path, match_id)) NOT VALID;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_audio_path_in_match_folder;
ALTER TABLE public.messages ADD CONSTRAINT messages_audio_path_in_match_folder
  CHECK (audio_path IS NULL OR public.is_valid_chat_media_path(audio_path, match_id)) NOT VALID;

DROP POLICY IF EXISTS "members send messages" ON public.messages;
CREATE POLICY "members send messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender = auth.uid()::text
    AND public.is_match_member(match_id)
    AND (body <> '' OR image_path IS NOT NULL OR audio_path IS NOT NULL)
    AND (image_path IS NULL OR public.is_valid_chat_media_path(image_path, match_id))
    AND (audio_path IS NULL OR public.is_valid_chat_media_path(audio_path, match_id))
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_id
      AND public.is_blocked_pair(m.user_a, m.user_b)
    )
  );

-- ---------- 4. Update guard trigger ----------
CREATE OR REPLACE FUNCTION public.messages_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.match_id := OLD.match_id;
  NEW.sender := OLD.sender;
  NEW.body := OLD.body;
  NEW.image_path := OLD.image_path;
  NEW.audio_path := OLD.audio_path;
  NEW.audio_duration_sec := OLD.audio_duration_sec;
  NEW.message_type := OLD.message_type;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END $$;

-- ---------- 5. Update get_match_messages RPC ----------
-- Return type gains columns; CREATE OR REPLACE cannot change OUT parameters.
DROP FUNCTION IF EXISTS public.get_match_messages(uuid);
CREATE FUNCTION public.get_match_messages(_match_id uuid)
RETURNS TABLE (
  id uuid,
  match_id uuid,
  sender text,
  body text,
  image_path text,
  audio_path text,
  audio_duration_sec integer,
  message_type text,
  created_at timestamptz,
  read_at timestamptz
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
  SELECT
    m.id,
    m.match_id,
    m.sender,
    m.body,
    m.image_path,
    m.audio_path,
    m.audio_duration_sec,
    m.message_type,
    m.created_at,
    -- If caller is the message sender: read_at is returned ONLY for Plus and VIP members.
    -- If caller is the recipient: read_at is returned normally.
    CASE
      WHEN m.sender = _my_id AND _tier NOT IN ('plus', 'vip') THEN NULL
      ELSE m.read_at
    END AS read_at
  FROM public.messages m
  WHERE m.match_id = _match_id
  ORDER BY m.created_at ASC;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_match_messages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_messages(uuid) TO authenticated, service_role;
