\set ON_ERROR_STOP on
-- 20260101006500: GIFs allowed in the private chat bucket only.
INSERT INTO public.t_results SELECT 'gif: chat bucket accepts image/gif', 'image/gif' = ANY (allowed_mime_types), allowed_mime_types::text
FROM storage.buckets WHERE id = 'chat';
INSERT INTO public.t_results SELECT 'gif: chat bucket stays private and 5 MB', NOT public AND file_size_limit = 5242880, file_size_limit::text
FROM storage.buckets WHERE id = 'chat';
INSERT INTO public.t_results SELECT 'gif: profile photos still refuse GIFs', NOT ('image/gif' = ANY (coalesce(allowed_mime_types, ARRAY[]::text[]))) AND allowed_mime_types IS NOT NULL, coalesce(allowed_mime_types::text, 'null')
FROM storage.buckets WHERE id = 'photos';
INSERT INTO public.t_results SELECT 'gif: voice types still allowed in chat', 'audio/m4a' = ANY (allowed_mime_types), ''
FROM storage.buckets WHERE id = 'chat';
