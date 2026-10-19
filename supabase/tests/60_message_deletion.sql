\set ON_ERROR_STOP on
-- 60_message_deletion.sql: Phase 3A message deletion (migration 20260101004200). Runs after 10_functional_rls.sql
-- (uses public.t_results, expect_fail, test_complete_profile).
-- Fixtures: A, B = members of M1; A, D = members of M2 (D later enters deletion-pending, then is purged);
-- S, B = members of M3 (S is suspended later); C = stranger. Rows/objects are seeded as superuser, every client
-- action runs as `authenticated` through RLS and the RPCs; worker actions run as `service_role`.

\o /dev/null
CREATE TABLE public.t60(k text PRIMARY KEY, v jsonb);
GRANT ALL ON public.t60 TO PUBLIC;
CREATE OR REPLACE FUNCTION public.t60_check(_name text, _ok boolean, _detail text DEFAULT '') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results VALUES (_name, coalesce(_ok, false), _detail)
$$;

INSERT INTO auth.users(id, email) VALUES
 ('f6000000-0000-0000-0000-000000000001','md-a@x'), ('f6000000-0000-0000-0000-000000000002','md-b@x'),
 ('f6000000-0000-0000-0000-000000000003','md-c@x'), ('f6000000-0000-0000-0000-000000000004','md-d@x'),
 ('f6000000-0000-0000-0000-000000000005','md-s@x');
CALL public.test_complete_profile('f6000000-0000-0000-0000-000000000001','MdA','1995-01-01','man','woman');
CALL public.test_complete_profile('f6000000-0000-0000-0000-000000000002','MdB','1995-01-01','woman','man');
CALL public.test_complete_profile('f6000000-0000-0000-0000-000000000003','MdC','1995-01-01','man','woman');
CALL public.test_complete_profile('f6000000-0000-0000-0000-000000000004','MdD','1995-01-01','man','woman');
CALL public.test_complete_profile('f6000000-0000-0000-0000-000000000005','MdS','1995-01-01','man','woman');
INSERT INTO public.matches(id, user_a, user_b) VALUES
 ('f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-000000000002'),
 ('f6c60000-0000-4000-8000-000000000002','f6000000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-000000000004'),
 ('f6c60000-0000-4000-8000-000000000003','f6000000-0000-0000-0000-000000000002','f6000000-0000-0000-0000-000000000005');

-- messages (superuser). Ids f6e50000-0000-4000-8000-0000000000NN
INSERT INTO public.messages(id, match_id, sender, body, image_path, audio_path, audio_duration_sec, message_type, is_view_once, created_at) VALUES
 ('f6e50000-0000-4000-8000-000000000001','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','secret plan one',NULL,NULL,NULL,'text',false, now()-interval '60 min'),
 ('f6e50000-0000-4000-8000-000000000002','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','',      'f6c60000-0000-4000-8000-000000000001/img-a2.jpg',NULL,NULL,'image',false, now()-interval '59 min'),
 ('f6e50000-0000-4000-8000-000000000003','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','Voice note',NULL,'f6c60000-0000-4000-8000-000000000001/voice-a3.m4a',12,'voice',false, now()-interval '58 min'),
 ('f6e50000-0000-4000-8000-000000000004','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000002','hello from B',NULL,NULL,NULL,'text',false, now()-interval '57 min'),
 ('f6e50000-0000-4000-8000-000000000005','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','for-me test',NULL,NULL,NULL,'text',false, now()-interval '56 min'),
 ('f6e50000-0000-4000-8000-000000000006','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','',      'f6c60000-0000-4000-8000-000000000001/img-a6.jpg',NULL,NULL,'image',false, now()-interval '55 min'),
 ('f6e50000-0000-4000-8000-000000000007','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','',      'f6c60000-0000-4000-8000-000000000001/vo-a7.jpg',NULL,NULL,'image',true, now()-interval '54 min'),
 ('f6e50000-0000-4000-8000-000000000008','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','',      'f6c60000-0000-4000-8000-000000000001/vo-a8.jpg',NULL,NULL,'image',true, now()-interval '53 min'),
 ('f6e50000-0000-4000-8000-000000000009','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','push live preview',NULL,NULL,NULL,'text',false, now()-interval '52 min'),
 ('f6e50000-0000-4000-8000-000000000010','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','push hidden preview',NULL,NULL,NULL,'text',false, now()-interval '51 min'),
 ('f6e50000-0000-4000-8000-000000000012','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','limit one',NULL,NULL,NULL,'text',false, now()+interval '1 day'),
 ('f6e50000-0000-4000-8000-000000000013','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','limit two',NULL,NULL,NULL,'text',false, now()+interval '1 day 1 min'),
 ('f6e50000-0000-4000-8000-000000000014','f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','limit three',NULL,NULL,NULL,'text',false, now()+interval '1 day 2 min'),
 ('f6e50000-0000-4000-8000-000000000015','f6c60000-0000-4000-8000-000000000002','f6000000-0000-0000-0000-000000000004','d text one',NULL,NULL,NULL,'text',false, now()-interval '40 min'),
 ('f6e50000-0000-4000-8000-000000000016','f6c60000-0000-4000-8000-000000000002','f6000000-0000-0000-0000-000000000004','',      'f6c60000-0000-4000-8000-000000000002/d-img.jpg',NULL,NULL,'image',false, now()-interval '39 min'),
 ('f6e50000-0000-4000-8000-000000000017','f6c60000-0000-4000-8000-000000000002','f6000000-0000-0000-0000-000000000004','d text hidden-by-d',NULL,NULL,NULL,'text',false, now()-interval '38 min'),
 ('f6e50000-0000-4000-8000-000000000018','f6c60000-0000-4000-8000-000000000002','f6000000-0000-0000-0000-000000000004','d text after pending',NULL,NULL,NULL,'text',false, now()-interval '37 min'),
 ('f6e50000-0000-4000-8000-000000000019','f6c60000-0000-4000-8000-000000000003','f6000000-0000-0000-0000-000000000005','s text',NULL,NULL,NULL,'text',false, now()-interval '30 min'),
 ('f6e50000-0000-4000-8000-000000000020','f6c60000-0000-4000-8000-000000000002','f6000000-0000-0000-0000-000000000001','a to d',NULL,NULL,NULL,'text',false, now()-interval '36 min');

INSERT INTO storage.objects(bucket_id, name, owner) VALUES
 ('chat','f6c60000-0000-4000-8000-000000000001/img-a2.jpg','f6000000-0000-0000-0000-000000000001'),
 ('chat','f6c60000-0000-4000-8000-000000000001/voice-a3.m4a','f6000000-0000-0000-0000-000000000001'),
 ('chat','f6c60000-0000-4000-8000-000000000001/img-a6.jpg','f6000000-0000-0000-0000-000000000001'),
 ('chat','f6c60000-0000-4000-8000-000000000001/vo-a7.jpg','f6000000-0000-0000-0000-000000000001'),
 ('chat','f6c60000-0000-4000-8000-000000000001/vo-a8.jpg','f6000000-0000-0000-0000-000000000001'),
 ('chat','f6c60000-0000-4000-8000-000000000002/d-img.jpg','f6000000-0000-0000-0000-000000000004');

-- ===== A. Structure ==============================================================================================
SELECT public.t60_check('md: messages.deleted_at exists',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' AND column_name='deleted_at'));
SELECT public.t60_check('md: tombstone content constraint exists',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname='messages_tombstone_has_no_content' AND conrelid='public.messages'::regclass));
SELECT public.t60_check('md: exactly one get_match_messages overload (no duplicate objects)',
  (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='get_match_messages') = 1);
SELECT public.t60_check('md: messages still use default replica identity (Realtime old records carry no content)',
  (SELECT relreplident FROM pg_class WHERE oid='public.messages'::regclass) = 'd');
SELECT public.t60_check('md: messages stays in the Realtime publication',
  EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='messages'));
SELECT public.t60_check('md: hide table and cleanup queue are NOT in the Realtime publication',
  NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename IN ('message_user_deletions','chat_media_cleanup_queue')));
SELECT public.t60_check('md: chat SELECT storage policy exists once and consults the cleanup queue',
  (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='chat read members'
     AND qual LIKE '%chat_media_pending_deletion%') = 1);
SELECT public.t60_check('md: messages SELECT policy hides deleted-for-me rows',
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='messages' AND policyname='members read messages' AND qual LIKE '%message_hidden_for_caller%'));
SELECT public.t60_check('md: no client-writable policy was added to the new tables',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('message_user_deletions','chat_media_cleanup_queue')));

-- ===== B. Grants =================================================================================================
SET ROLE anon;
CALL public.expect_fail('md: anon cannot call delete_message_for_everyone', $q$SELECT public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000001')$q$);
CALL public.expect_fail('md: anon cannot call delete_message_for_me', $q$SELECT public.delete_message_for_me('f6e50000-0000-4000-8000-000000000001')$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
CALL public.expect_fail('md: authenticated cannot read the cleanup queue', $q$SELECT * FROM public.chat_media_cleanup_queue$q$);
CALL public.expect_fail('md: authenticated cannot read the hide table', $q$SELECT * FROM public.message_user_deletions$q$);
CALL public.expect_fail('md: authenticated cannot write the hide table', $q$INSERT INTO public.message_user_deletions(message_id,user_id) VALUES ('f6e50000-0000-4000-8000-000000000004','f6000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_fail('md: authenticated cannot enqueue cleanup rows', $q$INSERT INTO public.chat_media_cleanup_queue(object_path,match_id,message_id) VALUES ('f6c60000-0000-4000-8000-000000000001/x.jpg','f6c60000-0000-4000-8000-000000000001','f6e50000-0000-4000-8000-000000000001')$q$);
CALL public.expect_fail('md: authenticated cannot claim cleanup work', $q$SELECT * FROM public.claim_chat_media_cleanup(10)$q$);
CALL public.expect_fail('md: authenticated cannot complete cleanup work', $q$SELECT public.complete_chat_media_cleanup(ARRAY[gen_random_uuid()])$q$);
CALL public.expect_fail('md: authenticated cannot fail cleanup work', $q$SELECT public.fail_chat_media_cleanup(gen_random_uuid(), 'x')$q$);
CALL public.expect_fail('md: client cannot insert a pre-tombstoned message (constraint + RLS)', $q$INSERT INTO public.messages(match_id,sender,body,deleted_at) VALUES ('f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','',now())$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = 'authenticated';
CALL public.expect_fail('md: authenticated role without a JWT subject cannot delete for me', $q$SELECT public.delete_message_for_me('f6e50000-0000-4000-8000-000000000001')$q$);
CALL public.expect_fail('md: authenticated role without a JWT subject cannot delete for everyone', $q$SELECT public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000001')$q$);
RESET ROLE;

-- ===== C. Delete for everyone: authorization =====================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('b_on_a_msg',   to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000001')));
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000003'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('c_on_a_msg',   to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000001')));
INSERT INTO public.t60 VALUES ('c_on_missing', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-0000000000ff')));
RESET ROLE;
SELECT public.t60_check('md: recipient cannot delete the sender''s message for everyone (forbidden)',
  (SELECT v->>'error' FROM public.t60 WHERE k='b_on_a_msg') = 'forbidden' AND (SELECT v->>'success' FROM public.t60 WHERE k='b_on_a_msg') = 'false');
SELECT public.t60_check('md: stranger gets message_not_found, identical to a nonexistent id (no existence oracle)',
  (SELECT v FROM public.t60 WHERE k='c_on_a_msg') = (SELECT v FROM public.t60 WHERE k='c_on_missing')
  AND (SELECT v->>'error' FROM public.t60 WHERE k='c_on_missing') = 'message_not_found');
SELECT public.t60_check('md: failed attempts changed nothing (message 01 intact, no queue rows yet)',
  (SELECT body FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000001') = 'secret plan one'
  AND (SELECT deleted_at FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000001') IS NULL
  AND (SELECT count(*) FROM public.chat_media_cleanup_queue) = 0);

-- sender deletes: text (01), image (02), voice (03), view-once image (08), push-live text (09)
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('a_del_01', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000001')));
INSERT INTO public.t60 VALUES ('a_del_02', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000002')));
INSERT INTO public.t60 VALUES ('a_del_03', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000003')));
INSERT INTO public.t60 VALUES ('a_del_08', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000008')));
RESET ROLE;
SELECT public.t60_check('md: sender delete for everyone succeeds for text, image, voice and view-once',
  (SELECT bool_and(v->>'status' = 'deleted') FROM public.t60 WHERE k IN ('a_del_01','a_del_02','a_del_03','a_del_08')));
SELECT public.t60_check('md: tombstone row scrubbed (text 01)',
  (SELECT (body = '' AND image_path IS NULL AND audio_path IS NULL AND deleted_at IS NOT NULL AND message_type = 'text')
     FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000001'));
SELECT public.t60_check('md: tombstone row scrubbed (image 02: path gone)',
  (SELECT (body = '' AND image_path IS NULL AND deleted_at IS NOT NULL) FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000002'));
SELECT public.t60_check('md: tombstone row scrubbed (voice 03: audio path and duration gone)',
  (SELECT (audio_path IS NULL AND audio_duration_sec IS NULL AND deleted_at IS NOT NULL) FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000003'));
SELECT public.t60_check('md: media paths were queued (image, voice, view-once) and the text message queued nothing',
  (SELECT count(*) FROM public.chat_media_cleanup_queue) = 3
  AND (SELECT count(*) FROM public.chat_media_cleanup_queue WHERE message_id='f6e50000-0000-4000-8000-000000000001') = 0
  AND (SELECT bool_and(status='pending' AND attempt_count = 0) FROM public.chat_media_cleanup_queue));
SELECT public.t60_check('md: queue stores no user identity (only match, message, path)',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chat_media_cleanup_queue' AND column_name ~ '(user|sender|owner|profile)'));

-- retries are idempotent
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('a_retry_02', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000002')));
INSERT INTO public.t60 VALUES ('a_retry_01', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000001')));
RESET ROLE;
SELECT public.t60_check('md: retry returns already_deleted with the original deleted_at',
  (SELECT v->>'status' FROM public.t60 WHERE k='a_retry_02') = 'already_deleted'
  AND (SELECT (v->>'deleted_at')::timestamptz FROM public.t60 WHERE k='a_retry_02') = (SELECT deleted_at FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000002'));
SELECT public.t60_check('md: retry did not duplicate queue rows', (SELECT count(*) FROM public.chat_media_cleanup_queue) = 3);

-- guard: clients cannot forge, undo or spoof tombstones
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
UPDATE public.messages SET deleted_at = NULL, body = 'resurrected' WHERE id='f6e50000-0000-4000-8000-000000000001';
UPDATE public.messages SET deleted_at = now(), body = '' WHERE id='f6e50000-0000-4000-8000-000000000005';
SELECT set_config('app.message_tombstone','f6e50000-0000-4000-8000-000000000005', false);
UPDATE public.messages SET deleted_at = now(), body = '', message_type='text' WHERE id='f6e50000-0000-4000-8000-000000000005';
SELECT set_config('app.message_tombstone','', false);
RESET ROLE;
SELECT public.t60_check('md: recipient cannot resurrect a tombstone via UPDATE',
  (SELECT body = '' AND deleted_at IS NOT NULL FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000001'));
SELECT public.t60_check('md: recipient cannot forge a tombstone, even by spoofing the GUC marker (guard checks current_user)',
  (SELECT body = 'for-me test' AND deleted_at IS NULL FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000005'));
CALL public.expect_fail('md: constraint rejects a tombstone row that still carries content (any writer, INSERT path)',
  $q$INSERT INTO public.messages(match_id,sender,body,deleted_at) VALUES ('f6c60000-0000-4000-8000-000000000001','f6000000-0000-0000-0000-000000000001','still text',now())$q$);
UPDATE public.messages SET deleted_at = now() WHERE id='f6e50000-0000-4000-8000-000000000004';
SELECT public.t60_check('md: even a privileged UPDATE outside delete_message_for_everyone cannot set deleted_at (guard)',
  (SELECT deleted_at IS NULL AND body = 'hello from B' FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000004'));

-- ===== D. Visibility after delete for everyone ===================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 SELECT 'b_direct_tomb', to_jsonb(m) FROM public.messages m WHERE m.id='f6e50000-0000-4000-8000-000000000002';
INSERT INTO public.t60 SELECT 'b_rpc_all', coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at), '[]') FROM public.get_match_messages('f6c60000-0000-4000-8000-000000000001', 100) r;
RESET ROLE;
SELECT public.t60_check('md: recipient direct query sees the tombstone row with no content',
  (SELECT v->>'body' = '' AND v->>'image_path' IS NULL AND v->>'deleted_at' IS NOT NULL FROM public.t60 WHERE k='b_direct_tomb'));
SELECT public.t60_check('md: get_match_messages returns tombstones with deleted_at and no content/media',
  (SELECT bool_and((e->>'body') = '' AND e->>'image_path' IS NULL AND e->>'audio_path' IS NULL AND e->>'audio_duration_sec' IS NULL)
     FROM public.t60, jsonb_array_elements(v) e WHERE k='b_rpc_all' AND e->>'deleted_at' IS NOT NULL)
  AND (SELECT count(*) FROM public.t60, jsonb_array_elements(v) e WHERE k='b_rpc_all' AND e->>'deleted_at' IS NOT NULL) = 4);
SELECT public.t60_check('md: the old body text appears nowhere in what the recipient can read',
  NOT EXISTS (SELECT 1 FROM public.t60 WHERE k IN ('b_direct_tomb','b_rpc_all') AND v::text LIKE '%secret plan one%'));

-- ===== E. Media access ===========================================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('b_obj_deleted',  to_jsonb((SELECT count(*) FROM storage.objects WHERE bucket_id='chat' AND name='f6c60000-0000-4000-8000-000000000001/img-a2.jpg')));
INSERT INTO public.t60 VALUES ('b_obj_voice',    to_jsonb((SELECT count(*) FROM storage.objects WHERE bucket_id='chat' AND name='f6c60000-0000-4000-8000-000000000001/voice-a3.m4a')));
INSERT INTO public.t60 VALUES ('b_obj_live',     to_jsonb((SELECT count(*) FROM storage.objects WHERE bucket_id='chat' AND name='f6c60000-0000-4000-8000-000000000001/img-a6.jpg')));
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('a_obj_deleted',  to_jsonb((SELECT count(*) FROM storage.objects WHERE bucket_id='chat' AND name='f6c60000-0000-4000-8000-000000000001/img-a2.jpg')));
INSERT INTO public.t60 VALUES ('a_obj_live',     to_jsonb((SELECT count(*) FROM storage.objects WHERE bucket_id='chat' AND name='f6c60000-0000-4000-8000-000000000001/img-a6.jpg')));
RESET ROLE;
SELECT public.t60_check('md: recipient can no longer read deleted image/voice objects (no new signed URLs)',
  (SELECT v FROM public.t60 WHERE k='b_obj_deleted') = '0' AND (SELECT v FROM public.t60 WHERE k='b_obj_voice') = '0');
SELECT public.t60_check('md: the sender is denied their own deleted media too', (SELECT v FROM public.t60 WHERE k='a_obj_deleted') = '0');
SELECT public.t60_check('md: media of non-deleted messages stays readable to both participants',
  (SELECT v FROM public.t60 WHERE k='b_obj_live') = '1' AND (SELECT v FROM public.t60 WHERE k='a_obj_live') = '1');
SELECT public.t60_check('md: the deleted object still exists in storage until the worker removes it (service_role can see it)',
  (SELECT count(*) FROM storage.objects WHERE name='f6c60000-0000-4000-8000-000000000001/img-a2.jpg') = 1);

-- ===== F. Delete for me ==========================================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000003'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('c_me_a_msg',   to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000005')));
INSERT INTO public.t60 VALUES ('c_me_missing', to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-0000000000ff')));
RESET ROLE;
SELECT public.t60_check('md: stranger cannot hide a message in a match they are not in (same answer as nonexistent id)',
  (SELECT v FROM public.t60 WHERE k='c_me_a_msg') = (SELECT v FROM public.t60 WHERE k='c_me_missing')
  AND (SELECT count(*) FROM public.message_user_deletions) = 0);

SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('b_me_05',   to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000005')));
INSERT INTO public.t60 VALUES ('b_me_05b',  to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000005')));
INSERT INTO public.t60 VALUES ('b_me_06',   to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000006')));
INSERT INTO public.t60 VALUES ('b_me_07',   to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000007')));
INSERT INTO public.t60 VALUES ('b_me_10',   to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000010')));
INSERT INTO public.t60 VALUES ('b_me_14',   to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000014')));
INSERT INTO public.t60 VALUES ('b_me_tomb', to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000001')));
INSERT INTO public.t60 VALUES ('b_direct_hidden', to_jsonb((SELECT count(*) FROM public.messages WHERE id IN ('f6e50000-0000-4000-8000-000000000005','f6e50000-0000-4000-8000-000000000006','f6e50000-0000-4000-8000-000000000001'))));
INSERT INTO public.t60 VALUES ('b_direct_unread', to_jsonb((SELECT count(*) FROM public.messages WHERE match_id='f6c60000-0000-4000-8000-000000000001' AND sender <> 'f6000000-0000-0000-0000-000000000002' AND read_at IS NULL AND id IN ('f6e50000-0000-4000-8000-000000000005','f6e50000-0000-4000-8000-000000000006'))));
INSERT INTO public.t60 SELECT 'b_rpc_after_hide', coalesce(jsonb_agg(r.id::text ORDER BY r.created_at), '[]') FROM public.get_match_messages('f6c60000-0000-4000-8000-000000000001', 100) r;
INSERT INTO public.t60 SELECT 'b_rpc_limit2', coalesce(jsonb_agg(r.id::text ORDER BY r.created_at), '[]') FROM public.get_match_messages('f6c60000-0000-4000-8000-000000000001', 2) r;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('a_direct_visible', to_jsonb((SELECT count(*) FROM public.messages WHERE id IN ('f6e50000-0000-4000-8000-000000000005','f6e50000-0000-4000-8000-000000000006','f6e50000-0000-4000-8000-000000000001'))));
INSERT INTO public.t60 SELECT 'a_rpc_after_hide', coalesce(jsonb_agg(r.id::text ORDER BY r.created_at), '[]') FROM public.get_match_messages('f6c60000-0000-4000-8000-000000000001', 100) r;
INSERT INTO public.t60 VALUES ('a_obj_after_b_hide', to_jsonb((SELECT count(*) FROM storage.objects WHERE bucket_id='chat' AND name='f6c60000-0000-4000-8000-000000000001/img-a6.jpg')));
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('b_obj_after_b_hide', to_jsonb((SELECT count(*) FROM storage.objects WHERE bucket_id='chat' AND name='f6c60000-0000-4000-8000-000000000001/img-a6.jpg')));
RESET ROLE;
SELECT public.t60_check('md: delete for me succeeds, and a retry reports already_deleted',
  (SELECT v->>'status' FROM public.t60 WHERE k='b_me_05') = 'deleted_for_me' AND (SELECT v->>'status' FROM public.t60 WHERE k='b_me_05b') = 'already_deleted'
  AND (SELECT count(*) FROM public.message_user_deletions WHERE message_id='f6e50000-0000-4000-8000-000000000005') = 1);
SELECT public.t60_check('md: hidden rows vanish from the caller''s direct queries (this is also what Realtime evaluates)',
  (SELECT v FROM public.t60 WHERE k='b_direct_hidden') = '0');
SELECT public.t60_check('md: hidden rows do not count as unread for the caller', (SELECT v FROM public.t60 WHERE k='b_direct_unread') = '0');
SELECT public.t60_check('md: hidden rows vanish from get_match_messages for the caller',
  NOT (SELECT v FROM public.t60 WHERE k='b_rpc_after_hide') ?| ARRAY['f6e50000-0000-4000-8000-000000000005','f6e50000-0000-4000-8000-000000000006','f6e50000-0000-4000-8000-000000000001']);
SELECT public.t60_check('md: the limit applies after hiding (newest N VISIBLE rows; hidden 14 is skipped)',
  (SELECT v FROM public.t60 WHERE k='b_rpc_limit2') = '["f6e50000-0000-4000-8000-000000000012","f6e50000-0000-4000-8000-000000000013"]'::jsonb);
SELECT public.t60_check('md: the other participant still sees everything the caller hid (rows and RPC)',
  (SELECT v FROM public.t60 WHERE k='a_direct_visible') = '3'
  AND (SELECT v FROM public.t60 WHERE k='a_rpc_after_hide') ?& ARRAY['f6e50000-0000-4000-8000-000000000005','f6e50000-0000-4000-8000-000000000006']);
SELECT public.t60_check('md: delete for me keeps the media readable for BOTH participants and queues nothing',
  (SELECT v FROM public.t60 WHERE k='a_obj_after_b_hide') = '1' AND (SELECT v FROM public.t60 WHERE k='b_obj_after_b_hide') = '1'
  AND NOT EXISTS (SELECT 1 FROM public.chat_media_cleanup_queue WHERE message_id IN ('f6e50000-0000-4000-8000-000000000006','f6e50000-0000-4000-8000-000000000007')));
SELECT public.t60_check('md: a tombstone can also be hidden for me', (SELECT v->>'status' FROM public.t60 WHERE k='b_me_tomb') = 'deleted_for_me');
SELECT public.t60_check('md: the hide rows are all still present (messages themselves untouched)',
  (SELECT count(*) FROM public.messages WHERE id IN ('f6e50000-0000-4000-8000-000000000005','f6e50000-0000-4000-8000-000000000006')) = 2);

-- sender hides first, then deletes for everyone: both work; the hide persists
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('a_me_09',  to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000009')));
INSERT INTO public.t60 VALUES ('a_all_09', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000009')));
RESET ROLE;
SELECT public.t60_check('md: delete for everyone works on a message the sender had hidden for themselves; hide row persists',
  (SELECT v->>'status' FROM public.t60 WHERE k='a_all_09') = 'deleted'
  AND EXISTS (SELECT 1 FROM public.message_user_deletions WHERE message_id='f6e50000-0000-4000-8000-000000000009' AND user_id='f6000000-0000-0000-0000-000000000001'));

-- ===== G. open_view_once_message =================================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('vo_hidden',  public.open_view_once_message('f6e50000-0000-4000-8000-000000000007'));
INSERT INTO public.t60 VALUES ('vo_deleted', public.open_view_once_message('f6e50000-0000-4000-8000-000000000008'));
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000003'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('vo_stranger', public.open_view_once_message('f6e50000-0000-4000-8000-000000000007'));
RESET ROLE;
SELECT public.t60_check('md: a hidden view-once message is not served and is NOT consumed',
  (SELECT v->>'error' FROM public.t60 WHERE k='vo_hidden') = 'message_not_found' AND NOT (SELECT v FROM public.t60 WHERE k='vo_hidden') ? 'image_path'
  AND (SELECT viewed_at FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000007') IS NULL);
SELECT public.t60_check('md: a deleted view-once message returns message_deleted and no path',
  (SELECT v->>'error' FROM public.t60 WHERE k='vo_deleted') = 'message_deleted' AND NOT (SELECT v FROM public.t60 WHERE k='vo_deleted') ? 'image_path');
SELECT public.t60_check('md: stranger still gets unauthorized from open_view_once_message', (SELECT v->>'error' FROM public.t60 WHERE k='vo_stranger') = 'unauthorized');

-- ===== H. Push ===================================================================================================
INSERT INTO public.notification_preferences(user_id, lock_screen_details) VALUES ('f6000000-0000-0000-0000-000000000002','preview')
  ON CONFLICT (user_id) DO UPDATE SET lock_screen_details = 'preview';
CREATE TABLE public.t60_push AS
  SELECT m.id AS msg_id, o.id AS outbox_id FROM public.messages m JOIN public.notification_outbox o ON o.category='message' AND o.event_id = m.id::text
  WHERE m.id IN ('f6e50000-0000-4000-8000-000000000009','f6e50000-0000-4000-8000-000000000010','f6e50000-0000-4000-8000-000000000012');
GRANT ALL ON public.t60_push TO PUBLIC;
SELECT public.t60_check('md: fixtures produced outbox rows for the push checks', (SELECT count(*) FROM public.t60_push) = 3);
SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
INSERT INTO public.t60 SELECT 'push_ctx', jsonb_object_agg(p.msg_id::text, to_jsonb(c.preview))
  FROM public.get_push_display_context((SELECT array_agg(outbox_id) FROM public.t60_push)) c JOIN public.t60_push p ON p.outbox_id = c.notification_id;
RESET ROLE;
SELECT public.t60_check('md: push preview is never produced for a deleted-for-everyone message',  (SELECT v->>'f6e50000-0000-4000-8000-000000000009' FROM public.t60 WHERE k='push_ctx') IS NULL);
SELECT public.t60_check('md: push preview is never produced for a message the recipient deleted for themselves', (SELECT v->>'f6e50000-0000-4000-8000-000000000010' FROM public.t60 WHERE k='push_ctx') IS NULL);
SELECT public.t60_check('md: push preview still works for a live message (control)', (SELECT v->>'f6e50000-0000-4000-8000-000000000012' FROM public.t60 WHERE k='push_ctx') = 'limit one');
SELECT public.t60_check('md: a deleted message no longer counts as a push source (queued push is suppressed)',
  NOT public._notification_source_exists('message','f6e50000-0000-4000-8000-000000000009')
  AND public._notification_source_exists('message','f6e50000-0000-4000-8000-000000000012'));

-- ===== I. Suspended / deletion-pending accounts ==================================================================
UPDATE public.profiles SET status = 'suspended' WHERE id = 'f6000000-0000-0000-0000-000000000005';
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000005'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('s_all', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000019')));
RESET ROLE;
SELECT public.t60_check('md: a suspended member cannot erase what they sent (account_not_active)',
  (SELECT v->>'error' FROM public.t60 WHERE k='s_all') = 'account_not_active'
  AND (SELECT body FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000019') = 's text');

-- D hides one message and deletes one image for everyone while still active
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000004'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('d_all_16', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000016')));
INSERT INTO public.t60 VALUES ('d_me_17',  to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000017')));
RESET ROLE;
SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
SELECT public.begin_account_deletion('f6000000-0000-0000-0000-000000000004');
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000004'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t60 VALUES ('d_pending_all', to_jsonb(public.delete_message_for_everyone('f6e50000-0000-4000-8000-000000000018')));
INSERT INTO public.t60 VALUES ('d_pending_me',  to_jsonb(public.delete_message_for_me('f6e50000-0000-4000-8000-000000000018')));
RESET ROLE;
SELECT public.t60_check('md: deletion-pending accounts cannot delete for everyone or for me',
  (SELECT v->>'error' FROM public.t60 WHERE k='d_pending_all') = 'account_deletion_pending'
  AND (SELECT v->>'error' FROM public.t60 WHERE k='d_pending_me') = 'account_deletion_pending'
  AND (SELECT body FROM public.messages WHERE id='f6e50000-0000-4000-8000-000000000018') = 'd text after pending'
  AND NOT EXISTS (SELECT 1 FROM public.message_user_deletions WHERE message_id='f6e50000-0000-4000-8000-000000000018'));
SELECT public.t60_check('md: D''s earlier delete-for-everyone image is queued before account deletion',
  EXISTS (SELECT 1 FROM public.chat_media_cleanup_queue WHERE object_path='f6c60000-0000-4000-8000-000000000002/d-img.jpg' AND status='pending'));

-- purge twice (the delete-account Edge Function retries): messages, hide rows and the match go; the queue entry stays
SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
SELECT public.purge_user_data('f6000000-0000-0000-0000-000000000004');
SELECT public.purge_user_data('f6000000-0000-0000-0000-000000000004');
RESET ROLE;
SELECT public.t60_check('md: purge removes the match, its messages and every hide row of the deleted account',
  NOT EXISTS (SELECT 1 FROM public.matches WHERE id='f6c60000-0000-4000-8000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.messages WHERE match_id='f6c60000-0000-4000-8000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.message_user_deletions WHERE message_id IN ('f6e50000-0000-4000-8000-000000000017')));
SELECT public.t60_check('md: the media cleanup entry SURVIVES account purge so the object is still removed',
  EXISTS (SELECT 1 FROM public.chat_media_cleanup_queue WHERE object_path='f6c60000-0000-4000-8000-000000000002/d-img.jpg' AND status='pending'));
SELECT public.t60_check('md: purging a user does not touch other members'' hide rows or tombstones in other matches',
  (SELECT count(*) FROM public.message_user_deletions WHERE user_id='f6000000-0000-0000-0000-000000000002') >= 6
  AND (SELECT count(*) FROM public.messages WHERE deleted_at IS NOT NULL AND match_id='f6c60000-0000-4000-8000-000000000001') = 5);

-- ===== J. Durable, retryable cleanup (worker RPCs as service_role) ===============================================
SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
INSERT INTO public.t60 SELECT 'claim1', coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM public.claim_chat_media_cleanup(2) c;
INSERT INTO public.t60 SELECT 'claim_rest', coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM public.claim_chat_media_cleanup(50) c;
INSERT INTO public.t60 SELECT 'claim_none', coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM public.claim_chat_media_cleanup(50) c;
RESET ROLE;
SELECT public.t60_check('md: claim respects the limit and never hands out a locked row twice',
  jsonb_array_length((SELECT v FROM public.t60 WHERE k='claim1')) = 2
  AND jsonb_array_length((SELECT v FROM public.t60 WHERE k='claim_rest')) = 2
  AND jsonb_array_length((SELECT v FROM public.t60 WHERE k='claim_none')) = 0);
SELECT public.t60_check('md: claimed rows are processing with attempt_count 1',
  (SELECT bool_and(status='processing' AND attempt_count=1 AND locked_at IS NOT NULL) FROM public.chat_media_cleanup_queue));

-- failure: back-off, then retry; success; idempotent complete
SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
SELECT public.fail_chat_media_cleanup((SELECT id FROM public.chat_media_cleanup_queue WHERE object_path='f6c60000-0000-4000-8000-000000000001/img-a2.jpg'), 'storage 503');
INSERT INTO public.t60 SELECT 'claim_backoff', coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM public.claim_chat_media_cleanup(50) c;
RESET ROLE;
SELECT public.t60_check('md: a failed item goes back to pending with last_error and a future retry time (back-off)',
  (SELECT status='pending' AND last_error='storage 503' AND next_attempt_at > now() FROM public.chat_media_cleanup_queue WHERE object_path='f6c60000-0000-4000-8000-000000000001/img-a2.jpg')
  AND jsonb_array_length((SELECT v FROM public.t60 WHERE k='claim_backoff')) = 0);
UPDATE public.chat_media_cleanup_queue SET next_attempt_at = now() - interval '1 second' WHERE object_path='f6c60000-0000-4000-8000-000000000001/img-a2.jpg';
SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
INSERT INTO public.t60 SELECT 'claim_retry', coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM public.claim_chat_media_cleanup(50) c;
RESET ROLE;
SELECT public.t60_check('md: after the back-off the item is retried with attempt_count 2',
  (SELECT (v->0->>'attempt_count')::int = 2 AND jsonb_array_length(v) = 1 FROM public.t60 WHERE k='claim_retry'));

-- a worker that crashed mid-flight: stale lock is reclaimed
UPDATE public.chat_media_cleanup_queue SET locked_at = now() - interval '11 minutes' WHERE object_path='f6c60000-0000-4000-8000-000000000001/voice-a3.m4a';
SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
INSERT INTO public.t60 SELECT 'claim_stale', coalesce(jsonb_agg(c.object_path), '[]') FROM public.claim_chat_media_cleanup(50) c;
RESET ROLE;
SELECT public.t60_check('md: a crashed worker''s stale lock is reclaimed on a later run (no reliance on any single caller or process)',
  (SELECT v FROM public.t60 WHERE k='claim_stale') = '["f6c60000-0000-4000-8000-000000000001/voice-a3.m4a"]'::jsonb);

SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
INSERT INTO public.t60 VALUES ('complete1', to_jsonb(public.complete_chat_media_cleanup((SELECT array_agg(id) FROM public.chat_media_cleanup_queue))));
INSERT INTO public.t60 VALUES ('complete2', to_jsonb(public.complete_chat_media_cleanup((SELECT array_agg(id) FROM public.chat_media_cleanup_queue))));
INSERT INTO public.t60 SELECT 'claim_after_done', coalesce(jsonb_agg(to_jsonb(c)), '[]') FROM public.claim_chat_media_cleanup(50) c;
RESET ROLE;
SELECT public.t60_check('md: complete is idempotent and finished items are never claimed again',
  (SELECT v FROM public.t60 WHERE k='complete1') = '4' AND (SELECT v FROM public.t60 WHERE k='complete2') = '0'
  AND jsonb_array_length((SELECT v FROM public.t60 WHERE k='claim_after_done')) = 0
  AND (SELECT bool_and(status='done' AND completed_at IS NOT NULL AND locked_at IS NULL) FROM public.chat_media_cleanup_queue));
SELECT public.t60_check('md: a finished path stays denied to clients (no reuse of a queued path)',
  public.chat_media_pending_deletion('f6c60000-0000-4000-8000-000000000001/img-a2.jpg'));
SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; RESET request.jwt.claim.sub;
SET request.jwt.claim.role = '';
CALL public.expect_fail('md: worker RPCs reject a caller without the service_role claim', $q$SELECT * FROM public.claim_chat_media_cleanup(1)$q$);
RESET ROLE;
\o

-- the "without claim" probes must fail for the RIGHT reason, not incidentally
SELECT public.t60_check('md: claim-less probes were rejected by the functions'' own checks',
  (SELECT bool_and(detail IN ('Authentication required','Service role required')) FROM public.t_results
    WHERE name IN ('md: authenticated role without a JWT subject cannot delete for me',
                   'md: authenticated role without a JWT subject cannot delete for everyone',
                   'md: worker RPCs reject a caller without the service_role claim')));
