-- 20260101003600_storage_chat_ownership_and_deletion_guard.sql
-- Phase 2 security hardening for Storage (additive; no schema or data changes, no table drops).
--
--   1. chat DELETE : a client may delete a chat object only if it is a valid single-level media path inside a match
--                    the caller belongs to (and is not blocked from) AND storage.objects.owner = auth.uid().
--                    Previously ANY match member could delete ANY object under the match folder, including the
--                    other member's images and voice notes.
--   2. chat INSERT : same strict path rule as the messages table (is_valid_chat_media_path): "<match id>/<one safe
--                    file name>". The old policy only looked at the first folder segment, so nested paths such as
--                    "<match id>/a/b.jpg" were accepted.
--   3. Deletion-pending guard: chat INSERT, chat DELETE, photos INSERT and photos DELETE are refused while
--                    account_state.data->>'deletionPending' = 'true' (the flag set only by begin_account_deletion()).
--   4. Existing photo ownership rule is preserved exactly: (storage.foldername(name))[1] = auth.uid()::text.
--
-- RLS composition: permissive policies are OR-ed, so adding a stricter policy next to the old one would change
-- nothing. The four affected policies are therefore DROPped (by their existing names) and recreated here. There is
-- deliberately NO UPDATE policy for chat or photos (objects cannot be overwritten or renamed in place).
-- assert_no_unreviewed_storage_policies() runs at the end and aborts this migration if some OTHER permissive
-- write policy on storage.objects (e.g. created in the dashboard) could still bypass these rules.
--
-- Not touched: the SELECT policies, photos_prevent_referenced_deletion trigger, service_role access (BYPASSRLS; the
-- delete-account function removes objects through the admin Storage client), buckets, and all other tables.
--
-- Known limitation: objects whose storage.objects.owner IS NULL (legacy / manually inserted) can no longer be
-- deleted by clients. This is intentional (no NULL-owner fallback); account deletion still removes them as service_role.

BEGIN;

-- 1. Helpers ----------------------------------------------------------------------------------------------------
-- True only for an authenticated caller whose account is NOT pending deletion. Fails closed without a JWT subject.
-- A user without an account_state row is not pending (onboarding creates the row later).
CREATE OR REPLACE FUNCTION public.account_not_deletion_pending()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.account_state s
       WHERE s.user_id = auth.uid()
         AND s.data ->> 'deletionPending' = 'true'
     )
$$;

REVOKE EXECUTE ON FUNCTION public.account_not_deletion_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_not_deletion_pending() TO authenticated, service_role;

-- Strict chat object name: "<match uuid>/<one safe file name>" inside a match the caller may use.
-- CASE guarantees the uuid cast only runs after the shape check, so malformed names return false, never an error.
CREATE OR REPLACE FUNCTION public.chat_media_member_path(_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN _name IS NOT NULL
     AND _name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
    THEN public.is_valid_chat_media_path(_name, split_part(_name, '/', 1)::uuid)
         AND public.chat_folder_member(split_part(_name, '/', 1))
    ELSE false
  END
$$;

REVOKE EXECUTE ON FUNCTION public.chat_media_member_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_media_member_path(text) TO authenticated, service_role;

-- 2. Chat policies (replace the broad membership-only ones) -------------------------------------------------------
DROP POLICY IF EXISTS "chat upload members" ON storage.objects;
CREATE POLICY "chat upload members" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat'
    AND public.chat_media_member_path(name)
    AND public.account_not_deletion_pending()
  );

DROP POLICY IF EXISTS "chat delete members" ON storage.objects;
CREATE POLICY "chat delete members" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat'
    AND owner = auth.uid()
    AND public.chat_media_member_path(name)
    AND public.account_not_deletion_pending()
  );

-- 3. Photo policies: existing own-folder rule + deletion-pending guard ------------------------------------------------
DROP POLICY IF EXISTS "photos write own folder" ON storage.objects;
CREATE POLICY "photos write own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.account_not_deletion_pending()
  );

DROP POLICY IF EXISTS "photos delete own folder" ON storage.objects;
CREATE POLICY "photos delete own folder" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.account_not_deletion_pending()
  );

-- 4. Guard against other permissive write policies that would OR around the rules above ---------------------------------
-- Reviewed policies = the SELECT policies (irrelevant to writes) and the four recreated above. Any other permissive
-- INSERT/UPDATE/DELETE/ALL policy that reaches client roles and is not pinned to some other bucket is reported.
CREATE OR REPLACE FUNCTION public.assert_no_unreviewed_storage_policies()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  _bad text;
BEGIN
  SELECT string_agg(p.policyname || ' (' || p.cmd || ')', ', ' ORDER BY p.policyname) INTO _bad
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname = 'storage'
    AND p.tablename = 'objects'
    AND p.permissive = 'PERMISSIVE'
    AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    AND p.roles::text[] && ARRAY['public', 'anon', 'authenticated']
    AND p.policyname NOT IN (
      'chat upload members', 'chat delete members', 'photos write own folder', 'photos delete own folder'
    )
    AND (
      coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~* '(chat|photos)'
      OR coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') !~* 'bucket_id'
    );
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unreviewed permissive storage.objects write policy could bypass chat/photos hardening: %', _bad;
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION public.assert_no_unreviewed_storage_policies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_no_unreviewed_storage_policies() TO service_role;

SELECT public.assert_no_unreviewed_storage_policies();

COMMIT;
