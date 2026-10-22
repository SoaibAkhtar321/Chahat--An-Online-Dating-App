-- 20260101004750_profile_voice_intro.sql
-- Profile voice intro: members record a short voice introduction while onboarding or completing their
-- profile; other members hear it on Discover and on the profile screen.
--   1. Private 'voice-intros' storage bucket (audio only, 5 MB), signed URLs only.
--   2. profiles.voice_intro_path / voice_intro_duration_sec, owner-writable, path pinned to the owner's folder.
--   3. get_voice_intros(): batch lookup of the intros another member may hear (active, onboarded, not blocked).
--   4. get_my_voice_intro(): the owner's own intro.
-- The long get_discovery_feed_page() function is deliberately NOT edited; the app batches one extra call.
BEGIN;

-- ---------- 1. Storage ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'voice-intros', 'voice-intros', false, 5242880,
  ARRAY['audio/m4a','audio/mp4','audio/aac','audio/mpeg','audio/webm','audio/ogg','audio/x-m4a']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Same visibility rule as photos: own folder, or an active, onboarded, unblocked profile's folder.
DROP POLICY IF EXISTS "voice intros read visible" ON storage.objects;
CREATE POLICY "voice intros read visible" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'voice-intros' AND public.photo_folder_visible((storage.foldername(name))[1]));
DROP POLICY IF EXISTS "voice intros write own folder" ON storage.objects;
CREATE POLICY "voice intros write own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'voice-intros' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "voice intros delete own folder" ON storage.objects;
CREATE POLICY "voice intros delete own folder" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'voice-intros' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 2. Columns ----------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS voice_intro_path text,
  ADD COLUMN IF NOT EXISTS voice_intro_duration_sec integer;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_voice_intro_duration_range;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_voice_intro_duration_range
  CHECK (voice_intro_duration_sec IS NULL OR (voice_intro_duration_sec BETWEEN 1 AND 60));

-- The path must be "<owner id>/<single safe file name>"; nobody can point at another member's file.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_voice_intro_path_owner;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_voice_intro_path_owner
  CHECK (
    voice_intro_path IS NULL
    OR (
      voice_intro_path ~ ('^' || id || '/voice_intro_[A-Za-z0-9._-]{1,120}$')
      AND position('..' in voice_intro_path) = 0
      AND voice_intro_duration_sec IS NOT NULL
    )
  );

GRANT UPDATE (voice_intro_path, voice_intro_duration_sec) ON public.profiles TO authenticated;

-- ---------- 3. Batch lookup for other members' intros ----------
CREATE OR REPLACE FUNCTION public.get_voice_intros(_ids text[])
RETURNS TABLE (id text, voice_intro_path text, voice_intro_duration_sec integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.voice_intro_path, p.voice_intro_duration_sec
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id = ANY (_ids[1:50])
    AND p.voice_intro_path IS NOT NULL
    AND (
      p.id = auth.uid()::text
      OR (p.status = 'active' AND p.onboarded AND NOT public.is_blocked_pair(p.id, auth.uid()::text))
    )
$$;
REVOKE EXECUTE ON FUNCTION public.get_voice_intros(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_voice_intros(text[]) TO authenticated;

-- ---------- 4. Own intro ----------
CREATE OR REPLACE FUNCTION public.get_my_voice_intro()
RETURNS TABLE (voice_intro_path text, voice_intro_duration_sec integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.voice_intro_path, p.voice_intro_duration_sec
  FROM public.profiles p WHERE p.id = auth.uid()::text
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_voice_intro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_voice_intro() TO authenticated;

COMMIT;
