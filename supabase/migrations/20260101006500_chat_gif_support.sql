-- 20260101006500_chat_gif_support.sql
-- GIFs in chat (2026-10-29): members can send GIFs/stickers from the Android keyboard or the gallery.
-- Only the private 'chat' bucket changes: image/gif is added to its allowed types. The size limit (5 MB), privacy
-- (private bucket, signed URLs), path rules (<match_id>/<file>) and all message policies are unchanged.
-- Profile photos ('photos' bucket) still do not accept GIFs.
BEGIN;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/m4a',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
  'audio/webm',
  'audio/ogg',
  'audio/x-m4a'
]
WHERE id = 'chat';

COMMIT;
