\set ON_ERROR_STOP on
-- 55_storage_chat_ownership.sql: Phase 2 Storage hardening (migration 20260101003600).
-- Fixtures: A, B = members of match M1; A, D = members of M2 (D later enters deletion-pending); B, C = members of M3
-- (A is NOT a member of M3); C is not a member of M1. Objects are seeded as the superuser (RLS bypassed), then every
-- client action runs as `authenticated` through RLS. Policy rejections must be RLS violations (42501), never an
-- incidental error. Deletes that RLS filters out affect 0 rows, so those are asserted by row count.

CREATE OR REPLACE PROCEDURE public.expect_rls_denied(_name text, _sql text) LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE _sql;
    INSERT INTO public.t_results VALUES(_name, false, 'succeeded but should be denied');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO public.t_results VALUES(_name, true, 'rls denied');
  WHEN OTHERS THEN
    INSERT INTO public.t_results VALUES(_name, false, 'wrong failure: ' || SQLSTATE || ' ' || SQLERRM);
  END;
END $$;
GRANT EXECUTE ON PROCEDURE public.expect_rls_denied(text,text) TO PUBLIC;

CREATE OR REPLACE PROCEDURE public.expect_rows(_name text, _sql text, _expected int) LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE _sql; GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.t_results VALUES(_name, n = _expected, 'rows=' || n || ' expected=' || _expected);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.t_results VALUES(_name, false, 'error: ' || SQLSTATE || ' ' || SQLERRM);
END $$;
GRANT EXECUTE ON PROCEDURE public.expect_rows(text,text,int) TO PUBLIC;

INSERT INTO auth.users (id, email) VALUES
 ('c5000000-0000-0000-0000-000000000001', 'p2a@x'), ('c5000000-0000-0000-0000-000000000002', 'p2b@x'), ('c5000000-0000-0000-0000-000000000003', 'p2c@x'), ('c5000000-0000-0000-0000-000000000004', 'p2d@x');
CALL public.test_complete_profile('c5000000-0000-0000-0000-000000000001', 'Ann', '1995-01-01', 'woman', 'man');
CALL public.test_complete_profile('c5000000-0000-0000-0000-000000000002', 'Bob', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('c5000000-0000-0000-0000-000000000003', 'Cat', '1995-01-01', 'woman', 'man');
CALL public.test_complete_profile('c5000000-0000-0000-0000-000000000004', 'Dan', '1995-01-01', 'man', 'woman');
INSERT INTO public.matches(id, user_a, user_b) VALUES
 ('c5c5c5c5-0000-4000-8000-0000000000a1', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002'), ('c5c5c5c5-0000-4000-8000-0000000000a2', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000004'), ('c5c5c5c5-0000-4000-8000-0000000000a3', 'c5000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000003');

-- Seed objects (superuser) ---------------------------------------------------------------------------------------------
INSERT INTO storage.objects(bucket_id, name, owner) VALUES
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a1/a-own-1.jpg',            'c5000000-0000-0000-0000-000000000001'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a1/a-own-2.png',            'c5000000-0000-0000-0000-000000000001'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a1/voice_a-own-3.m4a',      'c5000000-0000-0000-0000-000000000001'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a1/b-own-1.jpg',            'c5000000-0000-0000-0000-000000000002'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a1/legacy-null-owner.jpg',  NULL),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a1/sub/nested-a.jpg',       'c5000000-0000-0000-0000-000000000001'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a3/a-foreign-match.jpg',    'c5000000-0000-0000-0000-000000000001'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a3/c-own.jpg',              'c5000000-0000-0000-0000-000000000003'),
 ('chat', '/c5c5c5c5-0000-4000-8000-0000000000a1/slash-a.jpg',           'c5000000-0000-0000-0000-000000000001'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a1/../c5c5c5c5-0000-4000-8000-0000000000a3/trav-a.jpg',     'c5000000-0000-0000-0000-000000000001'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a1\back-a.jpg',             'c5000000-0000-0000-0000-000000000001'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a1/a..b.jpg',               'c5000000-0000-0000-0000-000000000001'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a1/c-upload-probe.jpg',     'c5000000-0000-0000-0000-000000000003'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a2/d-own.jpg',              'c5000000-0000-0000-0000-000000000004'),
 ('chat', 'c5c5c5c5-0000-4000-8000-0000000000a2/a-in-m2.jpg',            'c5000000-0000-0000-0000-000000000001'),
 ('photos', 'c5000000-0000-0000-0000-000000000001/extra.jpg',             'c5000000-0000-0000-0000-000000000001'),
 ('photos', 'c5000000-0000-0000-0000-000000000002/extra.jpg',             'c5000000-0000-0000-0000-000000000002'),
 ('photos', 'c5000000-0000-0000-0000-000000000004/extra-1.jpg',           'c5000000-0000-0000-0000-000000000004'),
 ('photos', 'c5000000-0000-0000-0000-000000000004/extra-2.jpg',           'c5000000-0000-0000-0000-000000000004');

-- A. Structure: policies, helpers, preserved safeguards ------------------------------------------------------------------
INSERT INTO public.t_results
SELECT 'p2 storage: the four hardened policies exist exactly once with the expected command',
  (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
     AND (policyname, cmd) IN (('chat upload members','INSERT'),('chat delete members','DELETE'),
                               ('photos write own folder','INSERT'),('photos delete own folder','DELETE'))) = 4, 'policies';
INSERT INTO public.t_results
SELECT 'p2 storage: no UPDATE or ALL policy exists on storage.objects (no in-place overwrite or rename)',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('UPDATE','ALL')), 'none';
INSERT INTO public.t_results
SELECT 'p2 storage: SELECT policies and the referenced-photo delete trigger are still present',
  (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
     AND policyname IN ('chat read members','photos read visible') AND cmd='SELECT') = 2
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='photos_prevent_referenced_deletion' AND NOT tgisinternal), 'present';
INSERT INTO public.t_results
SELECT 'p2 storage: helpers are SECURITY DEFINER with pinned search_path',
  bool_and(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')), string_agg(p.proname, ',')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('account_not_deletion_pending','chat_media_member_path','assert_no_unreviewed_storage_policies');
INSERT INTO public.t_results
SELECT 'p2 storage: anon cannot execute the new helpers; only service_role runs the policy audit',
  NOT has_function_privilege('anon','public.account_not_deletion_pending()','EXECUTE')
  AND NOT has_function_privilege('anon','public.chat_media_member_path(text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.assert_no_unreviewed_storage_policies()','EXECUTE')
  AND has_function_privilege('service_role','public.assert_no_unreviewed_storage_policies()','EXECUTE'), 'privileges';
INSERT INTO public.t_results
SELECT 'p2 storage: policy audit passes on the shipped policy set',
  (SELECT true FROM (SELECT public.assert_no_unreviewed_storage_policies()) s), 'ok';

-- B. Policy audit catches permissive policies that would OR around the hardening ------------------------------------------
CREATE POLICY rogue_chat_all ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'chat');
CALL public.expect_fail('p2 audit: rogue chat ALL policy is reported', $q$SELECT public.assert_no_unreviewed_storage_policies()$q$);
DROP POLICY rogue_chat_all ON storage.objects;
CREATE POLICY rogue_any_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (true);
CALL public.expect_fail('p2 audit: bucket-agnostic permissive INSERT policy is reported', $q$SELECT public.assert_no_unreviewed_storage_policies()$q$);
DROP POLICY rogue_any_insert ON storage.objects;
CREATE POLICY rogue_photos_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'photos');
CALL public.expect_fail('p2 audit: permissive photos UPDATE policy is reported', $q$SELECT public.assert_no_unreviewed_storage_policies()$q$);
DROP POLICY rogue_photos_update ON storage.objects;
CREATE POLICY other_bucket_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
CALL public.expect_ok('p2 audit: a policy pinned to an unrelated bucket is not reported', $q$SELECT public.assert_no_unreviewed_storage_policies()$q$);
DROP POLICY other_bucket_insert ON storage.objects;

-- C. Active member A: chat uploads -------------------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'c5000000-0000-0000-0000-000000000001';
CALL public.expect_ok('p2 chat upload: active member, image in own match folder',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/6f1d2c3a-0000-4000-8000-0000000000e1.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_ok('p2 chat upload: active member, voice note in own match folder',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/voice_6f1d2c3a-0000-4000-8000-0000000000e2.m4a','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_ok('p2 chat upload: active member, second match the user belongs to',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a2/6f1d2c3a-0000-4000-8000-0000000000e3.webp','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: match the user is not a member of',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a3/x.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: nested sub-folder',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/a/b.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: deeply nested folders',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/a/b/c/d.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: leading slash (absolute path)',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','/c5c5c5c5-0000-4000-8000-0000000000a1/x.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: traversal into a member match',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/../c5c5c5c5-0000-4000-8000-0000000000a2/x.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: traversal to ../../',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/../../x.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: dot-dot inside the file name',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/a..b.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: backslash separator',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1\x.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: empty file name',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: folder only, no file',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: no folder at all',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','x.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: hidden file name starting with a dot',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/.hidden','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: file name with a space',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/a b.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: file name longer than 200 characters',
  format($q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat',%L,'c5000000-0000-0000-0000-000000000001')$q$, 'c5c5c5c5-0000-4000-8000-0000000000a1/' || repeat('a', 201)));
CALL public.expect_rls_denied('p2 chat upload: upper-case match folder',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat',upper('c5c5c5c5-0000-4000-8000-0000000000a1') || '/x.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: non-uuid folder name',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','not-a-match/x.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 chat upload: NULL name',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat',NULL,'c5000000-0000-0000-0000-000000000001')$q$);

-- D. Active member A: chat deletes (RLS filters; assert row counts) ---------------------------------------------------------
CALL public.expect_rows('p2 chat delete: owner + match member can delete own object',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a1/a-own-1.jpg'$q$, 1);
CALL public.expect_rows('p2 chat delete: owner + member can delete own voice note',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a1/voice_a-own-3.m4a'$q$, 1);
CALL public.expect_rows('p2 chat delete: match member cannot delete the OTHER member''s object',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a1/b-own-1.jpg'$q$, 0);
CALL public.expect_rows('p2 chat delete: member cannot delete an object with NULL owner (no fallback)',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a1/legacy-null-owner.jpg'$q$, 0);
CALL public.expect_rows('p2 chat delete: owner cannot delete a nested-path object',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a1/sub/nested-a.jpg'$q$, 0);
CALL public.expect_rows('p2 chat delete: owner who is NOT a member of the match cannot delete (ownership alone is insufficient)',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a3/a-foreign-match.jpg'$q$, 0);
CALL public.expect_rows('p2 chat delete: other member''s object in a foreign match',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a3/c-own.jpg'$q$, 0);
CALL public.expect_rows('p2 chat delete: absolute, traversal, backslash and dot-dot names are never deletable',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name IN ('/c5c5c5c5-0000-4000-8000-0000000000a1/slash-a.jpg','c5c5c5c5-0000-4000-8000-0000000000a1/../c5c5c5c5-0000-4000-8000-0000000000a3/trav-a.jpg','c5c5c5c5-0000-4000-8000-0000000000a1\back-a.jpg','c5c5c5c5-0000-4000-8000-0000000000a1/a..b.jpg')$q$, 0);
CALL public.expect_rows('p2 chat delete: a bulk delete of the whole match folder only removes the caller''s own valid objects',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name LIKE 'c5c5c5c5-0000-4000-8000-0000000000a1%'$q$, 3);

-- E. Chat objects cannot be renamed or overwritten in place -------------------------------------------------------------------
CALL public.expect_rows('p2 chat update: owner cannot rename an object into another match folder',
  $q$UPDATE storage.objects SET name='c5c5c5c5-0000-4000-8000-0000000000a2/moved.jpg' WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a2/a-in-m2.jpg'$q$, 0);
CALL public.expect_rows('p2 photos update: owner cannot rename a photo object',
  $q$UPDATE storage.objects SET name='c5000000-0000-0000-0000-000000000001/renamed.jpg' WHERE bucket_id='photos' AND name='c5000000-0000-0000-0000-000000000001/extra.jpg'$q$, 0);

-- F. Non-member C --------------------------------------------------------------------------------------------------------------
SET request.jwt.claim.sub = 'c5000000-0000-0000-0000-000000000003';
CALL public.expect_rls_denied('p2 chat upload: non-member cannot upload into the match',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/evil.jpg','c5000000-0000-0000-0000-000000000003')$q$);
CALL public.expect_rows('p2 chat delete: non-member cannot delete the match''s media',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name LIKE 'c5c5c5c5-0000-4000-8000-0000000000a1/%'$q$, 0);
CALL public.expect_rows('p2 chat delete: non-member cannot delete an object it owns in a match it is not in',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a1/c-upload-probe.jpg'$q$, 0);
CALL public.expect_rows('p2 chat delete: authorized owner/member (C in M3) can still delete own object',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a3/c-own.jpg'$q$, 1);

-- G. Photos: existing rules preserved for an active user -----------------------------------------------------------------------
SET request.jwt.claim.sub = 'c5000000-0000-0000-0000-000000000001';
CALL public.expect_ok('p2 photos: active user can upload into own folder',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('photos','c5000000-0000-0000-0000-000000000001/new-photo.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rls_denied('p2 photos: user cannot upload into another user''s folder',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('photos','c5000000-0000-0000-0000-000000000002/hack.jpg','c5000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_rows('p2 photos: user can delete own unreferenced photo',
  $q$DELETE FROM storage.objects WHERE bucket_id='photos' AND name='c5000000-0000-0000-0000-000000000001/extra.jpg'$q$, 1);
CALL public.expect_rows('p2 photos: user cannot delete another user''s photo',
  $q$DELETE FROM storage.objects WHERE bucket_id='photos' AND name='c5000000-0000-0000-0000-000000000002/extra.jpg'$q$, 0);
CALL public.expect_fail('p2 photos: referenced-photo delete trigger still blocks deleting a photo used by the profile',
  $q$DELETE FROM storage.objects WHERE bucket_id='photos' AND name='c5000000-0000-0000-0000-000000000001/test-profile.jpg'$q$);
INSERT INTO public.t_results
SELECT 'p2 select: member still reads chat media and owner still reads own photos',
  (SELECT count(*) FROM storage.objects WHERE bucket_id='chat' AND name LIKE 'c5c5c5c5-0000-4000-8000-0000000000a2/%') >= 1
  AND (SELECT count(*) FROM storage.objects WHERE bucket_id='photos' AND name LIKE 'c5000000-0000-0000-0000-000000000001/%') >= 1, 'readable';
RESET ROLE;

INSERT INTO public.t_results
SELECT 'p2 chat delete: the other member''s, NULL-owner and invalid-path objects all survived (superuser view)',
  (SELECT count(*) FROM storage.objects WHERE bucket_id='chat' AND name IN
     ('c5c5c5c5-0000-4000-8000-0000000000a1/b-own-1.jpg','c5c5c5c5-0000-4000-8000-0000000000a1/legacy-null-owner.jpg','c5c5c5c5-0000-4000-8000-0000000000a1/sub/nested-a.jpg','c5c5c5c5-0000-4000-8000-0000000000a1/a..b.jpg')) = 4
  AND (SELECT count(*) FROM storage.objects WHERE bucket_id='chat' AND name IN
     ('/c5c5c5c5-0000-4000-8000-0000000000a1/slash-a.jpg','c5c5c5c5-0000-4000-8000-0000000000a1/../c5c5c5c5-0000-4000-8000-0000000000a3/trav-a.jpg','c5c5c5c5-0000-4000-8000-0000000000a1\back-a.jpg','c5c5c5c5-0000-4000-8000-0000000000a3/a-foreign-match.jpg')) = 4, 'survivors';

-- H. Deletion-pending account D ---------------------------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'c5000000-0000-0000-0000-000000000004';
CALL public.expect_ok('p2 pending: before deletion starts, D can upload chat media',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a2/d-before.jpg','c5000000-0000-0000-0000-000000000004')$q$);
CALL public.expect_ok('p2 pending: before deletion starts, D can upload a photo',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('photos','c5000000-0000-0000-0000-000000000004/before.jpg','c5000000-0000-0000-0000-000000000004')$q$);
CALL public.expect_rows('p2 pending: before deletion starts, D can delete an own photo',
  $q$DELETE FROM storage.objects WHERE bucket_id='photos' AND name='c5000000-0000-0000-0000-000000000004/extra-1.jpg'$q$, 1);
RESET ROLE;

SET request.jwt.claim.role = 'service_role';
SELECT public.begin_account_deletion('c5000000-0000-0000-0000-000000000004');
RESET request.jwt.claim.role;

SET ROLE authenticated;
SET request.jwt.claim.sub = 'c5000000-0000-0000-0000-000000000004';
CALL public.expect_rls_denied('p2 pending: D cannot upload chat media (valid path, valid match)',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a2/d-after.jpg','c5000000-0000-0000-0000-000000000004')$q$);
CALL public.expect_rls_denied('p2 pending: D cannot upload a voice note',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a2/voice_d-after.m4a','c5000000-0000-0000-0000-000000000004')$q$);
CALL public.expect_rls_denied('p2 pending: D cannot upload a photo into own folder',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('photos','c5000000-0000-0000-0000-000000000004/after.jpg','c5000000-0000-0000-0000-000000000004')$q$);
CALL public.expect_rows('p2 pending: D cannot delete own photo',
  $q$DELETE FROM storage.objects WHERE bucket_id='photos' AND name='c5000000-0000-0000-0000-000000000004/extra-2.jpg'$q$, 0);
CALL public.expect_rows('p2 pending: D cannot delete own chat media',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a2/d-own.jpg'$q$, 0);
CALL public.expect_rows('p2 pending: D cannot rename objects either',
  $q$UPDATE storage.objects SET name='c5c5c5c5-0000-4000-8000-0000000000a2/x.jpg' WHERE bucket_id='chat' AND name='c5c5c5c5-0000-4000-8000-0000000000a2/d-own.jpg'$q$, 0);
-- the helper itself, for pending and for an unauthenticated caller
INSERT INTO public.t_results SELECT 'p2 pending: account_not_deletion_pending() is false for D', NOT public.account_not_deletion_pending(), 'false';
SET request.jwt.claim.sub = 'c5000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'p2 pending: account_not_deletion_pending() stays true for active A', public.account_not_deletion_pending(), 'true';
CALL public.expect_ok('p2 pending: other member A (active) can still upload into the shared match',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a2/a-after-d-pending.jpg','c5000000-0000-0000-0000-000000000001')$q$);
SET request.jwt.claim.sub = '';
INSERT INTO public.t_results SELECT 'p2 helpers: no JWT subject fails closed (not pending is false, path check false)',
  NOT public.account_not_deletion_pending() AND NOT public.chat_media_member_path('c5c5c5c5-0000-4000-8000-0000000000a1/x.jpg') AND NOT public.chat_media_member_path(NULL), 'closed';
CALL public.expect_rls_denied('p2 chat upload: request without a JWT subject is denied',
  $q$INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('chat','c5c5c5c5-0000-4000-8000-0000000000a1/anon.jpg',NULL)$q$);
RESET ROLE;

-- I. service_role cleanup still works (account deletion path) ------------------------------------------------------------------
SET ROLE service_role;
CALL public.expect_rows('p2 service_role: removes NULL-owner and nested legacy chat objects (account deletion cleanup)',
  $q$DELETE FROM storage.objects WHERE bucket_id='chat' AND name IN ('c5c5c5c5-0000-4000-8000-0000000000a1/legacy-null-owner.jpg','c5c5c5c5-0000-4000-8000-0000000000a1/sub/nested-a.jpg','c5c5c5c5-0000-4000-8000-0000000000a1/a..b.jpg','/c5c5c5c5-0000-4000-8000-0000000000a1/slash-a.jpg')$q$, 4);
CALL public.expect_rows('p2 service_role: removes the pending user''s own chat and photo objects',
  $q$DELETE FROM storage.objects WHERE (bucket_id='chat' AND name LIKE 'c5c5c5c5-0000-4000-8000-0000000000a2/d-%') OR (bucket_id='photos' AND name = 'c5000000-0000-0000-0000-000000000004/extra-2.jpg')$q$, 3);
RESET ROLE;
