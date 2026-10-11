\set ON_ERROR_STOP on
-- users
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-0000-0000-00000000000a','a@x'),('00000000-0000-0000-0000-00000000000b','b@x'),('00000000-0000-0000-0000-00000000000c','c@x');
UPDATE public.profiles SET name='A',dob='1995-01-01',gender='man',seeking='woman',city='Pune',onboarded=true WHERE id='00000000-0000-0000-0000-00000000000a';
UPDATE public.profiles SET name='B',dob='1996-01-01',gender='woman',seeking='man',city='Pune',onboarded=true WHERE id='00000000-0000-0000-0000-00000000000b';
UPDATE public.profiles SET name='C',dob='1996-01-01',gender='woman',seeking='man',city='Pune',onboarded=true WHERE id='00000000-0000-0000-0000-00000000000c';
CREATE TABLE public.t_results(name text, ok boolean, detail text);
GRANT ALL ON public.t_results TO PUBLIC;
CREATE OR REPLACE PROCEDURE public.expect_fail(_name text, _sql text) LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE _sql; INSERT INTO public.t_results VALUES(_name,false,'succeeded but should fail');
  EXCEPTION WHEN OTHERS THEN INSERT INTO public.t_results VALUES(_name,true,SQLERRM); END;
END $$;
CREATE OR REPLACE PROCEDURE public.expect_ok(_name text, _sql text) LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE _sql; INSERT INTO public.t_results VALUES(_name,true,'ok');
  EXCEPTION WHEN OTHERS THEN INSERT INTO public.t_results VALUES(_name,false,SQLERRM); END;
END $$;
GRANT EXECUTE ON PROCEDURE public.expect_fail(text,text), public.expect_ok(text,text) TO PUBLIC;

-- anon
SET ROLE anon;
CALL public.expect_fail('anon cannot call is_blocked_pair','SELECT public.is_blocked_pair(''x'',''y'')');
CALL public.expect_fail('anon cannot call has_role','SELECT public.has_role(gen_random_uuid(),''admin'')');
CALL public.expect_fail('anon cannot call record_swipe','SELECT public.record_swipe(''ananya'',''like'')');
CALL public.expect_fail('anon cannot read profiles','SELECT * FROM public.profiles');
CALL public.expect_fail('anon cannot read swipes','SELECT * FROM public.swipes');
RESET ROLE;

-- user A
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a'; SET request.jwt.claim.role='authenticated';
CALL public.expect_fail('authed cannot select dob column','SELECT dob FROM public.profiles');
CALL public.expect_fail('authed cannot select * (dob)','SELECT * FROM public.profiles');
CALL public.expect_ok('authed can select non-dob cols','SELECT id,name,city FROM public.profiles');
CALL public.expect_fail('direct swipe insert blocked','INSERT INTO public.swipes(from_id,to_id,kind) VALUES (auth.uid()::text,''ananya'',''like'')');
CALL public.expect_fail('client cannot pass limits (4-arg rpc gone)','SELECT public.record_swipe(''ananya'',''like'',1000000,1000000)');
CALL public.expect_fail('app_settings unreadable','SELECT * FROM public.app_settings');
CALL public.expect_fail('quota table not writable','UPDATE public.user_daily_quotas SET likes_used=0');
CALL public.expect_fail('cannot self-delete via old rpc','SELECT public.delete_user_account()');
CALL public.expect_fail('cannot call purge_user_data','SELECT public.purge_user_data(auth.uid())');
CALL public.expect_fail('dob locked after set','UPDATE public.profiles SET dob=''1990-01-01'' WHERE id=auth.uid()::text');
INSERT INTO public.t_results SELECT 'get_my_dob returns own dob', public.get_my_dob()='1995-01-01', public.get_my_dob()::text;
INSERT INTO public.t_results SELECT 'get_public_profile has age no dob', age>0 AND age<100, age::text FROM public.get_public_profile('00000000-0000-0000-0000-00000000000b');
-- quota: 10 likes allowed to demo profiles? use real-like targets: ananya,meera,riya,sneha,ishita,kavya are 'woman' demos + b,c
DO $$ DECLARE r jsonb; i int; ok int:=0; targets text[]:=ARRAY['ananya','meera','riya','sneha','ishita','kavya','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c'];
BEGIN
  FOR i IN 1..8 LOOP r:=public.record_swipe(targets[i],'like'); IF (r->>'success')::boolean THEN ok:=ok+1; END IF; END LOOP;
  INSERT INTO public.t_results VALUES('8 likes succeed under limit 10', ok=8, ok::text);
END $$;
DO $$ DECLARE r jsonb; BEGIN
  r:=public.record_swipe('ananya','like'); INSERT INTO public.t_results VALUES('re-like same target is idempotent (no extra quota)', (r->>'success')::boolean AND (r->>'likes_remaining')::int=2, r::text);
END $$;
RESET ROLE;
-- bump quota via service-side config to test limit: set limit to 8 and verify cap
UPDATE public.app_settings SET value='8' WHERE key='daily_like_limit';
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
RESET ROLE; INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-00000000000d','d@x'),('00000000-0000-0000-0000-00000000000e','e@x'); UPDATE public.profiles SET name='E',dob='1996-01-01',gender='man',seeking='woman',city='Pune',onboarded=true WHERE id='00000000-0000-0000-0000-00000000000e';
UPDATE public.profiles SET name='D',dob='1996-01-01',gender='woman',seeking='man',city='Pune',onboarded=true WHERE id='00000000-0000-0000-0000-00000000000d';
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
DO $$ DECLARE r jsonb; BEGIN
  r:=public.record_swipe('00000000-0000-0000-0000-00000000000d','like');
  INSERT INTO public.t_results VALUES('9th like blocked at limit 8', NOT (r->>'success')::boolean AND r->>'error'='daily_like_limit_reached', r::text);
  r:=public.record_swipe('00000000-0000-0000-0000-00000000000d','pass');
  INSERT INTO public.t_results VALUES('pass is not quota-limited', (r->>'success')::boolean, r::text);
END $$;
-- priority quota 3
DO $$ DECLARE r jsonb; i int; ok int:=0; BEGIN
  FOR i IN 1..4 LOOP r:=public.record_swipe((ARRAY['ananya','meera','riya','sneha'])[i],'priority'); IF (r->>'success')::boolean THEN ok:=ok+1; END IF; END LOOP;
  INSERT INTO public.t_results VALUES('priority limit 3 enforced', ok=3, ok::text);
END $$;
CALL public.expect_fail('wrong gender swipe rejected','SELECT public.record_swipe(''00000000-0000-0000-0000-00000000000e'',''like'')');
CALL public.expect_fail('self swipe rejected','SELECT public.record_swipe(auth.uid()::text,''like'')');
CALL public.expect_fail('invalid kind rejected','SELECT public.record_swipe(''kavya'',''boost'')');
RESET ROLE;
-- mutual match
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
DO $$ DECLARE r jsonb; BEGIN
  r:=public.record_swipe('00000000-0000-0000-0000-00000000000a','like');
  INSERT INTO public.t_results VALUES('mutual like creates match for B', (r->>'is_match')::boolean AND r->>'match_id' IS NOT NULL, r::text);
END $$;
-- discovery feed contains no dob and excludes swiped
INSERT INTO public.t_results SELECT 'discovery excludes already-swiped', count(*)=0, count(*)::text FROM public.get_discovery_feed(50) WHERE id='00000000-0000-0000-0000-00000000000a';
RESET ROLE;
-- cross-user
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_results SELECT 'C cannot read A-B match', count(*)=0, count(*)::text FROM public.matches;
INSERT INTO public.t_results SELECT 'C sees only likes addressed to C (no A->others)', count(*)=count(*) FILTER (WHERE to_id='00000000-0000-0000-0000-00000000000c'), count(*)::text FROM public.swipes WHERE from_id='00000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_results SELECT 'C cannot read others quotas', count(*)=0, count(*)::text FROM public.user_daily_quotas;
DO $$ DECLARE n int; BEGIN
  UPDATE public.profiles SET name='hax' WHERE id='00000000-0000-0000-0000-00000000000a'; GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.t_results VALUES('C cannot update A profile', n=0, n::text);
END $$;
RESET ROLE;
CREATE TEMP TABLE mm AS SELECT id FROM public.matches LIMIT 1;
GRANT SELECT ON mm TO PUBLIC;
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000c';
DO $$ DECLARE m uuid := (SELECT id FROM mm); BEGIN
  PERFORM set_config('t.m', m::text, false); END $$;
CALL public.expect_fail('C cannot message into A-B match', format('INSERT INTO public.messages(match_id,sender,body) VALUES (%L, auth.uid()::text, ''hi'')', current_setting('t.m')));
RESET ROLE;
-- A can message; image_path must be in own match folder
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
CALL public.expect_ok('member can send text', format('INSERT INTO public.messages(match_id,sender,body) VALUES (%L, auth.uid()::text, ''hello'')', current_setting('t.m')));
CALL public.expect_fail('image_path outside match folder rejected', format('INSERT INTO public.messages(match_id,sender,image_path) VALUES (%L, auth.uid()::text, ''other-match/x.jpg'')', current_setting('t.m')));
CALL public.expect_ok('image_path inside match folder ok', format('INSERT INTO public.messages(match_id,sender,image_path) VALUES (%L, auth.uid()::text, %L)', current_setting('t.m'), current_setting('t.m')||'/m1.jpg'));
-- block pair probing
RESET ROLE;
INSERT INTO public.blocks(blocker,blocked) VALUES ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c');
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_results SELECT 'A cannot probe B-C block', public.is_blocked_pair('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c') = false, 'false';
SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_results SELECT 'B sees own block', public.is_blocked_pair('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c'), 'true';
INSERT INTO public.t_results SELECT 'blocked C hidden from B discovery', count(*)=0, count(*)::text FROM public.get_discovery_feed(50) WHERE id='00000000-0000-0000-0000-00000000000c';
CALL public.expect_fail('B cannot swipe blocked C','SELECT public.record_swipe(''00000000-0000-0000-0000-00000000000c'',''like'')');
INSERT INTO public.t_results SELECT 'non-admin has_role false', NOT public.has_role(auth.uid(),'admin'), 'false';
-- photo path ownership test
CALL public.expect_fail('B cannot set photo pointing to A folder', 'UPDATE public.profiles SET photos=''[{"id":"p1","path":"00000000-0000-0000-0000-00000000000a/p1.jpg"}]''::jsonb WHERE id=auth.uid()::text');
CALL public.expect_ok('B can set photo pointing to own folder', 'UPDATE public.profiles SET photos=''[{"id":"p1","path":"00000000-0000-0000-0000-00000000000b/p1.jpg"}]''::jsonb WHERE id=auth.uid()::text');
RESET ROLE;
-- check every SECURITY DEFINER function in schema public has search_path containing pg_temp
INSERT INTO public.t_results SELECT
  'all public security definer functions have search_path with pg_temp',
  count(*) = 0,
  coalesce(string_agg(proname, ', '), 'all ok')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef = true
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(p.proconfig) cfg
    WHERE cfg LIKE 'search_path=%' AND cfg LIKE '%pg_temp%'
  );

-- Part A1 tests: feed has no is_demo/likes_you columns, authed cannot select is_demo from profiles
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000b';
CALL public.expect_fail('authed cannot select is_demo from profiles', 'SELECT is_demo FROM public.profiles');
CALL public.expect_fail('authed cannot select likes_you from profiles', 'SELECT likes_you FROM public.profiles');
CALL public.expect_fail('discovery feed has no is_demo column', 'SELECT is_demo FROM public.get_discovery_feed(10)');
CALL public.expect_fail('discovery feed has no likes_you column', 'SELECT likes_you FROM public.get_discovery_feed(10)');

-- Part A2 tests: demo_reply revoked from authenticated
CALL public.expect_fail('authed cannot execute demo_reply', format('SELECT public.demo_reply(%L)', current_setting('t.m')));
RESET ROLE;

-- Part A3 tests: rate limits on messages (30/min) and reports (10/hr)
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000000a';
-- Insert 27 more messages (2 were already inserted in earlier tests)
DO $$
DECLARE
  i int;
  m uuid := current_setting('t.m')::uuid;
BEGIN
  FOR i IN 1..27 LOOP
    INSERT INTO public.messages(match_id, sender, body) VALUES (m, auth.uid()::text, 'msg ' || i);
  END LOOP;
END $$;
-- 30th message should succeed
CALL public.expect_ok('30th message succeeds under limit', format('INSERT INTO public.messages(match_id, sender, body) VALUES (%L, auth.uid()::text, ''msg 30'')', current_setting('t.m')));
-- 31st message should fail due to rate limit
CALL public.expect_fail('31st message rejected by rate limit', format('INSERT INTO public.messages(match_id, sender, body) VALUES (%L, auth.uid()::text, ''msg 31'')', current_setting('t.m')));

-- Reports rate limit: 10 reports allowed, 11th rejected
DO $$
DECLARE
  i int;
BEGIN
  FOR i IN 1..10 LOOP
    INSERT INTO public.reports(reporter, target, category, note)
    VALUES (auth.uid()::text, '00000000-0000-0000-0000-00000000000c', 'test category', 'note ' || i);
  END LOOP;
END $$;
CALL public.expect_fail('11th report rejected by rate limit', 'INSERT INTO public.reports(reporter, target, category, note) VALUES (auth.uid()::text, ''00000000-0000-0000-0000-00000000000c'', ''test'', ''over limit'')');
RESET ROLE;


