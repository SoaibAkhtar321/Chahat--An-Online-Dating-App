\set ON_ERROR_STOP on
-- Attacker regression (20260101006200 + earlier hardening): a signed-in FREE member tries to get paid features,
-- forge data or read other people's private data directly through the API. Every attempt must fail.
INSERT INTO auth.users(id, email) VALUES
  ('77000000-0000-0000-0000-00000000000f', 'atk-free@x'), ('77000000-0000-0000-0000-00000000000b', 'atk-b@x'),
  ('77000000-0000-0000-0000-00000000000c', 'atk-c@x'),    ('77000000-0000-0000-0000-0000000000ad', 'atk-admin@x');
CALL public.test_complete_profile('77000000-0000-0000-0000-00000000000f', 'AtkF', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('77000000-0000-0000-0000-00000000000b', 'AtkB', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('77000000-0000-0000-0000-00000000000c', 'AtkC', '1996-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('77aaaaaa-0000-0000-0000-000000000001', '77000000-0000-0000-0000-00000000000b', '77000000-0000-0000-0000-00000000000f');
INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at)
VALUES ('77000000-0000-0000-0000-00000000000c', 'vip', 'active', now() + interval '9 days');
INSERT INTO public.user_roles(user_id, role) VALUES ('77000000-0000-0000-0000-0000000000ad', 'admin');
INSERT INTO public.messages(id, match_id, sender, body)
VALUES ('77eeeeee-0000-4000-8000-000000000001', '77aaaaaa-0000-0000-0000-000000000001', '77000000-0000-0000-0000-00000000000b', 'from B');
CREATE TABLE public.t77 (k text PRIMARY KEY, v text);
GRANT ALL ON public.t77 TO PUBLIC;

SET ROLE authenticated; SET request.jwt.claim.sub = '77000000-0000-0000-0000-00000000000f'; SET request.jwt.claim.role = 'authenticated';
-- Paid features / money
CALL public.expect_fail('atk: grant myself VIP', $q$INSERT INTO public.user_subscriptions(user_id,tier,status,expires_at) VALUES ('77000000-0000-0000-0000-00000000000f','vip','active',now()+interval '1 year')$q$);
CALL public.expect_fail('atk: upgrade my row', $q$UPDATE public.user_subscriptions SET tier='vip' WHERE user_id='77000000-0000-0000-0000-00000000000f'$q$);
CALL public.expect_fail('atk: create coins (wallet)', $q$INSERT INTO public.coin_wallets(user_id,balance) VALUES ('77000000-0000-0000-0000-00000000000f',99999)$q$);
CALL public.expect_fail('atk: create coins (ledger)', $q$INSERT INTO public.coin_transactions(user_id,kind,amount,idempotency_key) VALUES ('77000000-0000-0000-0000-00000000000f','grant',999,'x')$q$);
CALL public.expect_fail('atk: reset like quota (update)', $q$UPDATE public.user_daily_quotas SET likes_used = 0$q$);
CALL public.expect_fail('atk: reset like quota (TRUNCATE)', $q$TRUNCATE public.user_daily_quotas$q$);
CALL public.expect_fail('atk: wipe swipes (TRUNCATE)', $q$TRUNCATE public.swipes$q$);
CALL public.expect_fail('atk: like without quota (insert swipes)', $q$INSERT INTO public.swipes(from_id,to_id,kind) VALUES ('77000000-0000-0000-0000-00000000000f','77000000-0000-0000-0000-00000000000c','like')$q$);
CALL public.expect_fail('atk: force a match', $q$INSERT INTO public.matches(user_a,user_b) VALUES ('77000000-0000-0000-0000-00000000000c','77000000-0000-0000-0000-00000000000f')$q$);
CALL public.expect_fail('atk: who liked me (RPC) as free', $q$SELECT * FROM public.get_received_likes(10, NULL)$q$);
CALL public.expect_fail('atk: likes count (RPC) as free', $q$SELECT public.get_incoming_likes_count()$q$);
CALL public.expect_fail('atk: my sent likes (RPC) as free', $q$SELECT * FROM public.get_my_sent_likes(10, NULL)$q$);
CALL public.expect_fail('atk: change server limits', $q$UPDATE public.app_settings SET value='999' WHERE key='call_free_daily_seconds'$q$);
CALL public.expect_fail('atk: lengthen a call', $q$UPDATE public.video_calls SET free_call_until = now() + interval '1 day'$q$);
CALL public.expect_fail('atk: insert a call row', $q$INSERT INTO public.video_calls(match_id,caller_id,recipient_id,call_type,expires_at) VALUES ('77aaaaaa-0000-0000-0000-000000000001','77000000-0000-0000-0000-00000000000f','77000000-0000-0000-0000-00000000000b','video',now()+interval '1 day')$q$);
CALL public.expect_fail('atk: call-token context (service only)', $q$SELECT public.get_call_join_context(gen_random_uuid(), auth.uid())$q$);
-- Roles / identity
CALL public.expect_fail('atk: make myself admin', $q$INSERT INTO public.user_roles(user_id, role) VALUES ('77000000-0000-0000-0000-00000000000f','admin')$q$);
CALL public.expect_fail('atk: self-verify', $q$UPDATE public.account_state SET data = data || '{"verification":{"status":"approved"}}' WHERE user_id = auth.uid()$q$);
CALL public.expect_fail('atk: change my status / demo flags', $q$UPDATE public.profiles SET status='active', is_demo=true WHERE id = auth.uid()::text$q$);
CALL public.expect_fail('atk: 5 MB settings blob', $q$UPDATE public.account_state SET data = data || jsonb_build_object('junk', repeat('x', 5000000)) WHERE user_id = auth.uid()$q$);
-- Other people's data
CALL public.expect_fail('atk: anyone''s plan via get_active_subscription_tier', $q$SELECT public.get_active_subscription_tier('77000000-0000-0000-0000-00000000000c')$q$);
INSERT INTO public.t77 SELECT 'profiles_others', count(*)::text FROM public.profiles WHERE id <> auth.uid()::text;
INSERT INTO public.t77 SELECT 'profiles_me', count(*)::text FROM public.profiles WHERE id = auth.uid()::text;
INSERT INTO public.t77 SELECT 'has_role_other', public.has_role('77000000-0000-0000-0000-0000000000ad', 'admin')::text;
INSERT INTO public.t77 SELECT 'admin_audit', count(*)::text FROM public.admin_audit;
INSERT INTO public.t77 SELECT 'others_subs', count(*)::text FROM public.user_subscriptions WHERE user_id <> auth.uid()::text;
CALL public.expect_fail('atk: read exact locations', $q$SELECT * FROM public.discovery_locations$q$);
CALL public.expect_fail('atk: read push tokens', $q$SELECT * FROM public.push_devices$q$);
CALL public.expect_fail('atk: read read-receipts', $q$SELECT read_at FROM public.messages$q$);
-- Chat forgery
CALL public.expect_fail('atk: forge a system message (fake call history)', $q$INSERT INTO public.messages(match_id,sender,body,message_type) VALUES ('77aaaaaa-0000-0000-0000-000000000001','77000000-0000-0000-0000-00000000000f','call|video|ended|00000000-0000-0000-0000-000000000000|3600','system')$q$);
CALL public.expect_fail('atk: send as someone else', $q$INSERT INTO public.messages(match_id,sender,body) VALUES ('77aaaaaa-0000-0000-0000-000000000001','77000000-0000-0000-0000-00000000000b','spoof')$q$);
CALL public.expect_fail('atk: message a non-match', $q$INSERT INTO public.messages(match_id,sender,body) VALUES (gen_random_uuid(),'77000000-0000-0000-0000-00000000000f','hi')$q$);
INSERT INTO public.messages(id, match_id, sender, body, created_at, delivered_at, read_at, viewed_at)
VALUES ('77eeeeee-0000-4000-8000-000000000002', '77aaaaaa-0000-0000-0000-000000000001', '77000000-0000-0000-0000-00000000000f',
        'pinned forever', now() + interval '10 years', now(), now(), now());
UPDATE public.messages SET body = 'edited' WHERE id = '77eeeeee-0000-4000-8000-000000000001';
-- Reports
CALL public.expect_fail('atk: report as someone else', $q$INSERT INTO public.reports(reporter,target,category,source,status) VALUES ('77000000-0000-0000-0000-00000000000b','77000000-0000-0000-0000-00000000000c','spam','profile','open')$q$);
CALL public.expect_fail('atk: pre-resolved report', $q$INSERT INTO public.reports(reporter,target,category,source,status) VALUES (auth.uid()::text,'77000000-0000-0000-0000-00000000000c','spam','profile','dismissed')$q$);
CALL public.expect_fail('atk: report a non-existent account', $q$INSERT INTO public.reports(reporter,target,category,source,status) VALUES (auth.uid()::text,'not-a-user','spam','profile','open')$q$);
CALL public.expect_fail('atk: report myself', $q$INSERT INTO public.reports(reporter,target,category,source,status) VALUES (auth.uid()::text,auth.uid()::text,'spam','profile','open')$q$);
INSERT INTO public.reports(reporter, target, category, source, status)
VALUES (auth.uid()::text, '77000000-0000-0000-0000-00000000000c', 'spam', 'profile', 'open');
RESET ROLE;

INSERT INTO public.t_results SELECT 'atk: members read only their own profile row from the table',
  (SELECT v FROM public.t77 WHERE k = 'profiles_others') = '0' AND (SELECT v FROM public.t77 WHERE k = 'profiles_me') = '1', '';
INSERT INTO public.t_results SELECT 'atk: cannot learn whether someone else is an admin',
  (SELECT v FROM public.t77 WHERE k = 'has_role_other') = 'false', '';
INSERT INTO public.t_results SELECT 'atk: admin audit and others'' subscriptions are invisible',
  (SELECT v FROM public.t77 WHERE k = 'admin_audit') = '0' AND (SELECT v FROM public.t77 WHERE k = 'others_subs') = '0', '';
INSERT INTO public.t_results SELECT 'atk: client-set timestamps on a new message are replaced by the server',
  created_at <= now() AND created_at > now() - interval '1 hour' AND delivered_at IS NULL AND read_at IS NULL AND viewed_at IS NULL,
  created_at::text
FROM public.messages WHERE id = '77eeeeee-0000-4000-8000-000000000002';
INSERT INTO public.t_results SELECT 'atk: the other person''s message cannot be edited',
  body = 'from B', body FROM public.messages WHERE id = '77eeeeee-0000-4000-8000-000000000001';
INSERT INTO public.t_results SELECT 'atk: a legitimate report still works',
  count(*) = 1, count(*)::text FROM public.reports WHERE reporter = '77000000-0000-0000-0000-00000000000f';
-- Server-written call-history system messages keep working: covered by 70_call_connect_clock.sql.
INSERT INTO public.t_results SELECT 'atk: still nobody but the admin has a role',
  count(*) = 1, count(*)::text FROM public.user_roles WHERE user_id::text LIKE '77000000%';
