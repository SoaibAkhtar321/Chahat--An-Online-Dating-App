
CREATE POLICY "photos read signed-in" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos');
CREATE POLICY "photos write own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "photos update own folder" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "photos delete own folder" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE OR REPLACE FUNCTION public.chat_folder_member(_folder text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.matches WHERE id::text = _folder AND auth.uid()::text IN (user_a, user_b));
END $$;

CREATE POLICY "chat read members" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat' AND public.chat_folder_member((storage.foldername(name))[1]));
CREATE POLICY "chat upload members" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat' AND public.chat_folder_member((storage.foldername(name))[1]));
