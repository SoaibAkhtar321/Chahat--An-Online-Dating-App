-- Private storage buckets + policies. Photos and chat media are NEVER public; the app uses signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('photos', 'photos', false, 5242880, ARRAY['image/jpeg','image/png','image/webp']),
  ('chat',   'chat',   false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Visible = own folder, or an active, onboarded, unblocked profile's folder.
CREATE OR REPLACE FUNCTION public.photo_folder_visible(_folder text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _folder = auth.uid()::text OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _folder AND p.status = 'active' AND p.onboarded
      AND NOT public.is_blocked_pair(p.id, auth.uid()::text))
$$;

CREATE OR REPLACE FUNCTION public.chat_folder_member(_folder text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.matches WHERE id::text = _folder AND auth.uid()::text IN (user_a, user_b))
$$;

DROP POLICY IF EXISTS "photos read signed-in" ON storage.objects;
DROP POLICY IF EXISTS "photos read visible" ON storage.objects;
CREATE POLICY "photos read visible" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND public.photo_folder_visible((storage.foldername(name))[1]));
DROP POLICY IF EXISTS "photos write own folder" ON storage.objects;
CREATE POLICY "photos write own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "photos update own folder" ON storage.objects;
CREATE POLICY "photos update own folder" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'photos' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "photos delete own folder" ON storage.objects;
CREATE POLICY "photos delete own folder" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "chat read members" ON storage.objects;
CREATE POLICY "chat read members" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat' AND public.chat_folder_member((storage.foldername(name))[1]));
DROP POLICY IF EXISTS "chat upload members" ON storage.objects;
CREATE POLICY "chat upload members" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat' AND public.chat_folder_member((storage.foldername(name))[1]));
