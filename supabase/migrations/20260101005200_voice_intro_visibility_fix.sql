-- 20260101005200_voice_intro_visibility_fix.sql
-- Bug: members could record a voice intro but nobody else could hear it on their profile.
-- Cause: the "voice intros read visible" Storage policy (20260101004750) reused photo_folder_visible(), which the
-- photo stopgap (20260101000800) narrowed to "owner only" and which photos no longer use (they moved to
-- photo_object_readable() in 20260101001000). Other members' createSignedUrls() calls were therefore denied and the
-- profile player silently rendered nothing.
-- Fix: give voice intros their own visibility function with the rule get_voice_intros() already applies (the owner, or
-- an active, onboarded member who is not blocked either way) and point the read policy at it. photo_folder_visible()
-- and the photo policies are NOT touched.
BEGIN;

CREATE OR REPLACE FUNCTION public.voice_intro_folder_visible(_folder text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    _folder = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = _folder
        AND p.status = 'active'
        AND p.onboarded
        AND NOT public.is_blocked_pair(p.id, auth.uid()::text)
    )
  )
$$;
REVOKE EXECUTE ON FUNCTION public.voice_intro_folder_visible(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voice_intro_folder_visible(text) TO authenticated;

DROP POLICY IF EXISTS "voice intros read visible" ON storage.objects;
CREATE POLICY "voice intros read visible" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'voice-intros' AND public.voice_intro_folder_visible((storage.foldername(name))[1]));

COMMIT;
