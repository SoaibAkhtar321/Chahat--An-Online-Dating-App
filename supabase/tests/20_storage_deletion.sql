\set ON_ERROR_STOP on
SELECT set_config('t.mid',(SELECT id::text FROM public.matches WHERE user_a LIKE '%00a' OR user_b LIKE '%00a' LIMIT 1),false);
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_results SELECT 'C reads 0 messages of A-B match', count(*)=0, count(*)::text FROM public.messages;
RESET ROLE;
-- storage: objects
INSERT INTO storage.buckets SELECT 'x','x' WHERE false;
INSERT INTO public.t_results SELECT 'photos bucket private', NOT public, public::text FROM storage.buckets WHERE id='photos';
INSERT INTO public.t_results SELECT 'chat bucket private', NOT public, public::text FROM storage.buckets WHERE id='chat';
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('photos','00000000-0000-0000-0000-00000000000a/p1.jpg'),
 ('photos','00000000-0000-0000-0000-00000000000b/p1.jpg'),
 ('photos','00000000-0000-0000-0000-00000000000c/p1.jpg');
INSERT INTO storage.objects(bucket_id,name) SELECT 'chat', id::text||'/m1.jpg' FROM public.matches LIMIT 1;
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_results SELECT 'A sees own + B photo, not blocked-C-irrelevant', count(*)=3, count(*)::text FROM storage.objects WHERE bucket_id='photos';
INSERT INTO public.t_results SELECT 'A (match member) reads chat media', count(*)=1, count(*)::text FROM storage.objects WHERE bucket_id='chat';
CALL public.expect_fail('A cannot upload into B folder',$q$INSERT INTO storage.objects(bucket_id,name) VALUES ('photos','00000000-0000-0000-0000-00000000000b/hack.jpg')$q$);
CALL public.expect_ok('A can upload to own folder',$q$INSERT INTO storage.objects(bucket_id,name) VALUES ('photos','00000000-0000-0000-0000-00000000000a/new.jpg')$q$);
DO $$ DECLARE n int; BEGIN DELETE FROM storage.objects WHERE name LIKE '00000000-0000-0000-0000-00000000000b/%'; GET DIAGNOSTICS n=ROW_COUNT; INSERT INTO public.t_results VALUES('A cannot delete B photo', n=0, n::text); END $$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_results SELECT 'C cannot read chat media of A-B', count(*)=0, count(*)::text FROM storage.objects WHERE bucket_id='chat';
CALL public.expect_fail('C cannot upload chat media into A-B', format($q$INSERT INTO storage.objects(bucket_id,name) VALUES ('chat', %L)$q$, current_setting('t.mid')||'/evil.jpg'));
RESET ROLE;
-- B blocks C: B's photos hidden from C, C's hidden from B
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_results SELECT 'blocked pair photos hidden (C cannot see B photo)', count(*) FILTER (WHERE name LIKE '%000b/%')=0, count(*)::text FROM storage.objects WHERE bucket_id='photos';
RESET ROLE;
-- suspended profile photos hidden
SET request.jwt.claim.role='service_role'; UPDATE public.profiles SET status='suspended' WHERE id='00000000-0000-0000-0000-00000000000a'; RESET request.jwt.claim.role;
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_results SELECT 'suspended user photos hidden from others', count(*) FILTER (WHERE name LIKE '%000a/%')=0, count(*)::text FROM storage.objects WHERE bucket_id='photos';
RESET ROLE;
SET request.jwt.claim.role='service_role'; UPDATE public.profiles SET status='active' WHERE id='00000000-0000-0000-0000-00000000000a'; RESET request.jwt.claim.role;
-- purge twice (retry safe) + data gone + audit
SELECT public.purge_user_data('00000000-0000-0000-0000-00000000000a');
SELECT public.purge_user_data('00000000-0000-0000-0000-00000000000a');
INSERT INTO public.t_results SELECT 'purge removes profile/swipes/matches/messages/quotas/state',
  NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='00000000-0000-0000-0000-00000000000a')
  AND NOT EXISTS(SELECT 1 FROM public.swipes WHERE from_id='00000000-0000-0000-0000-00000000000a' OR to_id='00000000-0000-0000-0000-00000000000a')
  AND NOT EXISTS(SELECT 1 FROM public.matches WHERE user_a='00000000-0000-0000-0000-00000000000a' OR user_b='00000000-0000-0000-0000-00000000000a')
  AND (SELECT count(*) FROM public.messages)=0
  AND NOT EXISTS(SELECT 1 FROM public.user_daily_quotas WHERE user_id='00000000-0000-0000-0000-00000000000a')
  AND NOT EXISTS(SELECT 1 FROM public.account_state WHERE user_id='00000000-0000-0000-0000-00000000000a'), 'purge x2 ok';
INSERT INTO public.t_results SELECT 'purge retry safe: audit rows written', count(*)=2, count(*)::text FROM public.admin_audit WHERE action='account_self_deleted';
-- deleting auth user afterwards cascades cleanly
DELETE FROM auth.users WHERE id='00000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_results VALUES('auth user delete after purge ok', true, 'ok');
