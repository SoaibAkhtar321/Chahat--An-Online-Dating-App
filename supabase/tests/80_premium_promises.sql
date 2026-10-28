\set ON_ERROR_STOP on
-- Premium promise audit (2026-10-29): every benefit printed on the plan cards (mobile/src/services/subscription.ts
-- PLANS) is checked against what the SERVER actually gives each tier. Free / Premium / Plus / VIP side by side.
--   Free:    limited daily likes, 30 s video/day, no who-liked-you, no sent likes, no rewind, no read receipts
--   Premium: unlimited likes, 300 s video/day, who liked you, profiles you liked, rewind
--   Plus:    Premium + read receipts      VIP: Plus (no extra benefit)
CREATE TABLE public.t80 (k text PRIMARY KEY, v text);
GRANT ALL ON public.t80 TO PUBLIC;
INSERT INTO public.app_settings (key, value) VALUES ('daily_like_limit', '2'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO auth.users(id, email) VALUES
('8a000000-0000-0000-0000-00000000000f','pa-f@x'),
('8a000000-0000-0000-0000-00000000000e','pa-p@x'),
('8a000000-0000-0000-0000-00000000000d','pa-l@x'),
('8a000000-0000-0000-0000-00000000000c','pa-v@x'),
('8a000000-0000-0000-0000-0000000000a1','pa-t0@x'),
('8a000000-0000-0000-0000-0000000000b1','pa-t1@x'),
('8a000000-0000-0000-0000-0000000000c1','pa-t2@x'),
('8a000000-0000-0000-0000-0000000000d1','pa-t3@x');
CALL public.test_complete_profile('8a000000-0000-0000-0000-00000000000f', 'Paf', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('8a000000-0000-0000-0000-00000000000e', 'Pap', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('8a000000-0000-0000-0000-00000000000d', 'Pal', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('8a000000-0000-0000-0000-00000000000c', 'Pav', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('8a000000-0000-0000-0000-0000000000a1', 'PaT0', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('8a000000-0000-0000-0000-0000000000b1', 'PaT1', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('8a000000-0000-0000-0000-0000000000c1', 'PaT2', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('8a000000-0000-0000-0000-0000000000d1', 'PaT3', '1996-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES ('80aaaaaa-0000-0000-0000-00000000000f', '8a000000-0000-0000-0000-00000000000f', '8a000000-0000-0000-0000-0000000000d1');
INSERT INTO public.messages(id, match_id, sender, body, read_at) VALUES ('80eeeeee-0000-4000-8000-00000000000f', '80aaaaaa-0000-0000-0000-00000000000f', '8a000000-0000-0000-0000-00000000000f', 'hi', now());
INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at) VALUES ('8a000000-0000-0000-0000-00000000000e', 'premium', 'active', now() + interval '7 days');
INSERT INTO public.matches(id, user_a, user_b) VALUES ('80aaaaaa-0000-0000-0000-00000000000e', '8a000000-0000-0000-0000-00000000000e', '8a000000-0000-0000-0000-0000000000d1');
INSERT INTO public.messages(id, match_id, sender, body, read_at) VALUES ('80eeeeee-0000-4000-8000-00000000000e', '80aaaaaa-0000-0000-0000-00000000000e', '8a000000-0000-0000-0000-00000000000e', 'hi', now());
INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at) VALUES ('8a000000-0000-0000-0000-00000000000d', 'plus', 'active', now() + interval '7 days');
INSERT INTO public.matches(id, user_a, user_b) VALUES ('80aaaaaa-0000-0000-0000-00000000000d', '8a000000-0000-0000-0000-00000000000d', '8a000000-0000-0000-0000-0000000000d1');
INSERT INTO public.messages(id, match_id, sender, body, read_at) VALUES ('80eeeeee-0000-4000-8000-00000000000d', '80aaaaaa-0000-0000-0000-00000000000d', '8a000000-0000-0000-0000-00000000000d', 'hi', now());
INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at) VALUES ('8a000000-0000-0000-0000-00000000000c', 'vip', 'active', now() + interval '7 days');
INSERT INTO public.matches(id, user_a, user_b) VALUES ('80aaaaaa-0000-0000-0000-00000000000c', '8a000000-0000-0000-0000-00000000000c', '8a000000-0000-0000-0000-0000000000d1');
INSERT INTO public.messages(id, match_id, sender, body, read_at) VALUES ('80eeeeee-0000-4000-8000-00000000000c', '80aaaaaa-0000-0000-0000-00000000000c', '8a000000-0000-0000-0000-00000000000c', 'hi', now());

SET ROLE authenticated; SET request.jwt.claim.sub = '8a000000-0000-0000-0000-00000000000f'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t80 SELECT 'f:quota', public.get_daily_like_quota()::text;
INSERT INTO public.t80 SELECT 'f:like0', public.record_swipe('8a000000-0000-0000-0000-0000000000a1', 'like')::text;
INSERT INTO public.t80 SELECT 'f:like1', public.record_swipe('8a000000-0000-0000-0000-0000000000b1', 'like')::text;
INSERT INTO public.t80 SELECT 'f:like2', public.record_swipe('8a000000-0000-0000-0000-0000000000c1', 'like')::text;
INSERT INTO public.t80 SELECT 'f:allow', public.get_my_video_call_allowance()->>'daily_limit_seconds';
DO $$ BEGIN INSERT INTO public.t80 VALUES ('f:wholiked', (SELECT count(*) FROM public.get_received_likes(10, NULL))::text); EXCEPTION WHEN OTHERS THEN INSERT INTO public.t80 VALUES ('f:wholiked', 'DENIED:' || SQLERRM); END $$;
DO $$ BEGIN INSERT INTO public.t80 VALUES ('f:sent', (SELECT count(*) FROM public.get_my_sent_likes(10, NULL))::text); EXCEPTION WHEN OTHERS THEN INSERT INTO public.t80 VALUES ('f:sent', 'DENIED:' || SQLERRM); END $$;
INSERT INTO public.t80 SELECT 'f:pass', public.record_swipe('8a000000-0000-0000-0000-0000000000d1', 'pass')::text;
INSERT INTO public.t80 SELECT 'f:rewind', public.undo_swipe_pass('8a000000-0000-0000-0000-0000000000d1')::text;
INSERT INTO public.t80 SELECT 'f:receipt', coalesce((SELECT last_message_read::text FROM public.get_chat_list_state(NULL) WHERE match_id = '80aaaaaa-0000-0000-0000-00000000000f'), 'hidden');
RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;

SET ROLE authenticated; SET request.jwt.claim.sub = '8a000000-0000-0000-0000-00000000000e'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t80 SELECT 'p:quota', public.get_daily_like_quota()::text;
INSERT INTO public.t80 SELECT 'p:like0', public.record_swipe('8a000000-0000-0000-0000-0000000000a1', 'like')::text;
INSERT INTO public.t80 SELECT 'p:like1', public.record_swipe('8a000000-0000-0000-0000-0000000000b1', 'like')::text;
INSERT INTO public.t80 SELECT 'p:like2', public.record_swipe('8a000000-0000-0000-0000-0000000000c1', 'like')::text;
INSERT INTO public.t80 SELECT 'p:allow', public.get_my_video_call_allowance()->>'daily_limit_seconds';
DO $$ BEGIN INSERT INTO public.t80 VALUES ('p:wholiked', (SELECT count(*) FROM public.get_received_likes(10, NULL))::text); EXCEPTION WHEN OTHERS THEN INSERT INTO public.t80 VALUES ('p:wholiked', 'DENIED:' || SQLERRM); END $$;
DO $$ BEGIN INSERT INTO public.t80 VALUES ('p:sent', (SELECT count(*) FROM public.get_my_sent_likes(10, NULL))::text); EXCEPTION WHEN OTHERS THEN INSERT INTO public.t80 VALUES ('p:sent', 'DENIED:' || SQLERRM); END $$;
INSERT INTO public.t80 SELECT 'p:pass', public.record_swipe('8a000000-0000-0000-0000-0000000000d1', 'pass')::text;
INSERT INTO public.t80 SELECT 'p:rewind', public.undo_swipe_pass('8a000000-0000-0000-0000-0000000000d1')::text;
INSERT INTO public.t80 SELECT 'p:receipt', coalesce((SELECT last_message_read::text FROM public.get_chat_list_state(NULL) WHERE match_id = '80aaaaaa-0000-0000-0000-00000000000e'), 'hidden');
RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;

SET ROLE authenticated; SET request.jwt.claim.sub = '8a000000-0000-0000-0000-00000000000d'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t80 SELECT 'l:quota', public.get_daily_like_quota()::text;
INSERT INTO public.t80 SELECT 'l:like0', public.record_swipe('8a000000-0000-0000-0000-0000000000a1', 'like')::text;
INSERT INTO public.t80 SELECT 'l:like1', public.record_swipe('8a000000-0000-0000-0000-0000000000b1', 'like')::text;
INSERT INTO public.t80 SELECT 'l:like2', public.record_swipe('8a000000-0000-0000-0000-0000000000c1', 'like')::text;
INSERT INTO public.t80 SELECT 'l:allow', public.get_my_video_call_allowance()->>'daily_limit_seconds';
DO $$ BEGIN INSERT INTO public.t80 VALUES ('l:wholiked', (SELECT count(*) FROM public.get_received_likes(10, NULL))::text); EXCEPTION WHEN OTHERS THEN INSERT INTO public.t80 VALUES ('l:wholiked', 'DENIED:' || SQLERRM); END $$;
DO $$ BEGIN INSERT INTO public.t80 VALUES ('l:sent', (SELECT count(*) FROM public.get_my_sent_likes(10, NULL))::text); EXCEPTION WHEN OTHERS THEN INSERT INTO public.t80 VALUES ('l:sent', 'DENIED:' || SQLERRM); END $$;
INSERT INTO public.t80 SELECT 'l:pass', public.record_swipe('8a000000-0000-0000-0000-0000000000d1', 'pass')::text;
INSERT INTO public.t80 SELECT 'l:rewind', public.undo_swipe_pass('8a000000-0000-0000-0000-0000000000d1')::text;
INSERT INTO public.t80 SELECT 'l:receipt', coalesce((SELECT last_message_read::text FROM public.get_chat_list_state(NULL) WHERE match_id = '80aaaaaa-0000-0000-0000-00000000000d'), 'hidden');
RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;

SET ROLE authenticated; SET request.jwt.claim.sub = '8a000000-0000-0000-0000-00000000000c'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t80 SELECT 'v:quota', public.get_daily_like_quota()::text;
INSERT INTO public.t80 SELECT 'v:like0', public.record_swipe('8a000000-0000-0000-0000-0000000000a1', 'like')::text;
INSERT INTO public.t80 SELECT 'v:like1', public.record_swipe('8a000000-0000-0000-0000-0000000000b1', 'like')::text;
INSERT INTO public.t80 SELECT 'v:like2', public.record_swipe('8a000000-0000-0000-0000-0000000000c1', 'like')::text;
INSERT INTO public.t80 SELECT 'v:allow', public.get_my_video_call_allowance()->>'daily_limit_seconds';
DO $$ BEGIN INSERT INTO public.t80 VALUES ('v:wholiked', (SELECT count(*) FROM public.get_received_likes(10, NULL))::text); EXCEPTION WHEN OTHERS THEN INSERT INTO public.t80 VALUES ('v:wholiked', 'DENIED:' || SQLERRM); END $$;
DO $$ BEGIN INSERT INTO public.t80 VALUES ('v:sent', (SELECT count(*) FROM public.get_my_sent_likes(10, NULL))::text); EXCEPTION WHEN OTHERS THEN INSERT INTO public.t80 VALUES ('v:sent', 'DENIED:' || SQLERRM); END $$;
INSERT INTO public.t80 SELECT 'v:pass', public.record_swipe('8a000000-0000-0000-0000-0000000000d1', 'pass')::text;
INSERT INTO public.t80 SELECT 'v:rewind', public.undo_swipe_pass('8a000000-0000-0000-0000-0000000000d1')::text;
INSERT INTO public.t80 SELECT 'v:receipt', coalesce((SELECT last_message_read::text FROM public.get_chat_list_state(NULL) WHERE match_id = '80aaaaaa-0000-0000-0000-00000000000c'), 'hidden');
RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;

CREATE FUNCTION public.t80v(_k text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM public.t80 WHERE k = _k $$;
-- Free: what the Free card says, and none of the paid benefits.
INSERT INTO public.t_results VALUES
 ('promise free: daily like limit applies (2 in this test, 50 in production)', (public.t80v('f:quota')::jsonb->>'daily_limit')::int = 2, public.t80v('f:quota')),
 ('promise free: 3rd like over the limit is refused', public.t80v('f:like2')::jsonb->>'error' = 'daily_like_limit_reached', public.t80v('f:like2')),
 ('promise free: 30 s video/day', public.t80v('f:allow') = '30', public.t80v('f:allow')),
 ('promise free: no who-liked-you', public.t80v('f:wholiked') LIKE 'DENIED:%', public.t80v('f:wholiked')),
 ('promise free: no sent-likes list', public.t80v('f:sent') LIKE 'DENIED:%', public.t80v('f:sent')),
 ('promise free: no rewind', coalesce((public.t80v('f:rewind')::jsonb->>'success')::boolean, false) = false, public.t80v('f:rewind')),
 ('promise free: no read receipts', public.t80v('f:receipt') = 'hidden', public.t80v('f:receipt'));
-- Every paid tier: all Premium benefits.  Plus and VIP: read receipts too.
INSERT INTO public.t_results
SELECT 'promise ' || t.tier || ': ' || c.name, c.ok, c.detail
FROM (VALUES ('p','premium'),('l','plus'),('v','vip')) t(k, tier)
CROSS JOIN LATERAL (VALUES
  ('unlimited likes (quota)', (public.t80v(t.k || ':quota')::jsonb->>'unlimited')::boolean IS TRUE, public.t80v(t.k || ':quota')),
  ('unlimited likes (3rd like over the free limit succeeds)', (public.t80v(t.k || ':like2')::jsonb->>'success')::boolean IS TRUE, public.t80v(t.k || ':like2')),
  ('5 minutes/day video', public.t80v(t.k || ':allow') = '300', public.t80v(t.k || ':allow')),
  ('see who liked you', public.t80v(t.k || ':wholiked') NOT LIKE 'DENIED:%', public.t80v(t.k || ':wholiked')),
  ('see the profiles you liked (3)', public.t80v(t.k || ':sent') = '3', public.t80v(t.k || ':sent')),
  ('rewind a pass', (public.t80v(t.k || ':rewind')::jsonb->>'success')::boolean IS TRUE, public.t80v(t.k || ':rewind')),
  ('read receipts only on Plus/VIP', CASE WHEN t.tier = 'premium' THEN public.t80v(t.k || ':receipt') = 'hidden'
                                          ELSE public.t80v(t.k || ':receipt') = 'true' END, public.t80v(t.k || ':receipt'))
) c(name, ok, detail);
-- VIP is advertised as "All Plus features" only: nothing in the server gives VIP more than Plus (decision pending).
INSERT INTO public.app_settings (key, value) VALUES ('daily_like_limit', '50'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
