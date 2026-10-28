\set ON_ERROR_STOP on
-- 20260101005900: read receipts (the other person's read_at on MY messages) are Plus/VIP only, on every path.
INSERT INTO auth.users(id, email) VALUES
  ('73000000-0000-0000-0000-00000000000a', 'rr-free@x'),     -- free sender
  ('73000000-0000-0000-0000-00000000000b', 'rr-reader@x'),   -- recipient (free)
  ('73000000-0000-0000-0000-00000000000c', 'rr-plus@x'),     -- plus sender
  ('73000000-0000-0000-0000-00000000000d', 'rr-vip@x'),      -- vip sender
  ('73000000-0000-0000-0000-00000000000e', 'rr-expired@x'),  -- expired plus sender
  ('73000000-0000-0000-0000-00000000000f', 'rr-premium@x'),  -- premium sender (premium has no receipts)
  ('73000000-0000-0000-0000-000000000011', 'rr-stranger@x');
CALL public.test_complete_profile('73000000-0000-0000-0000-00000000000a', 'RrA', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('73000000-0000-0000-0000-00000000000b', 'RrB', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('73000000-0000-0000-0000-00000000000c', 'RrC', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('73000000-0000-0000-0000-00000000000d', 'RrD', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('73000000-0000-0000-0000-00000000000e', 'RrE', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('73000000-0000-0000-0000-00000000000f', 'RrF', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('73000000-0000-0000-0000-000000000011', 'RrS', '1996-01-01', 'woman', 'man');
INSERT INTO public.user_subscriptions(user_id, tier, status, starts_at, expires_at) VALUES
  ('73000000-0000-0000-0000-00000000000c', 'plus', 'active', now() - interval '1 day', now() + interval '10 days'),
  ('73000000-0000-0000-0000-00000000000d', 'vip', 'active', now() - interval '1 day', now() + interval '10 days'),
  ('73000000-0000-0000-0000-00000000000e', 'plus', 'active', now() - interval '20 days', now() - interval '1 minute'),
  ('73000000-0000-0000-0000-00000000000f', 'premium', 'active', now() - interval '1 day', now() + interval '5 days');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('73aaaaaa-0000-0000-0000-0000000000a1', '73000000-0000-0000-0000-00000000000a', '73000000-0000-0000-0000-00000000000b'),
  ('73aaaaaa-0000-0000-0000-0000000000a2', '73000000-0000-0000-0000-00000000000b', '73000000-0000-0000-0000-00000000000c'),
  ('73aaaaaa-0000-0000-0000-0000000000a3', '73000000-0000-0000-0000-00000000000b', '73000000-0000-0000-0000-00000000000d'),
  ('73aaaaaa-0000-0000-0000-0000000000a4', '73000000-0000-0000-0000-00000000000b', '73000000-0000-0000-0000-00000000000e'),
  ('73aaaaaa-0000-0000-0000-0000000000a5', '73000000-0000-0000-0000-00000000000b', '73000000-0000-0000-0000-00000000000f');
INSERT INTO public.messages(id, match_id, sender, body, created_at) VALUES
  ('73eeeeee-0000-4000-8000-0000000000a1', '73aaaaaa-0000-0000-0000-0000000000a1', '73000000-0000-0000-0000-00000000000a', 'hi from free', now() - interval '5 minutes'),
  ('73eeeeee-0000-4000-8000-0000000000a2', '73aaaaaa-0000-0000-0000-0000000000a1', '73000000-0000-0000-0000-00000000000b', 'reply 1', now() - interval '4 minutes'),
  ('73eeeeee-0000-4000-8000-0000000000a3', '73aaaaaa-0000-0000-0000-0000000000a1', '73000000-0000-0000-0000-00000000000b', 'reply 2', now() - interval '3 minutes'),
  ('73eeeeee-0000-4000-8000-0000000000a4', '73aaaaaa-0000-0000-0000-0000000000a1', '73000000-0000-0000-0000-00000000000a', 'free last', now() - interval '1 minute'),
  ('73eeeeee-0000-4000-8000-0000000000c1', '73aaaaaa-0000-0000-0000-0000000000a2', '73000000-0000-0000-0000-00000000000c', 'hi from plus', now() - interval '1 minute'),
  ('73eeeeee-0000-4000-8000-0000000000d1', '73aaaaaa-0000-0000-0000-0000000000a3', '73000000-0000-0000-0000-00000000000d', 'hi from vip', now() - interval '1 minute'),
  ('73eeeeee-0000-4000-8000-0000000000e1', '73aaaaaa-0000-0000-0000-0000000000a4', '73000000-0000-0000-0000-00000000000e', 'hi from expired', now() - interval '1 minute'),
  ('73eeeeee-0000-4000-8000-0000000000f1', '73aaaaaa-0000-0000-0000-0000000000a5', '73000000-0000-0000-0000-00000000000f', 'hi from premium', now() - interval '1 minute');

CREATE TABLE public.t73 (k text PRIMARY KEY, v jsonb);
GRANT ALL ON public.t73 TO PUBLIC;

-- ===== A. Privileges (the basis for PostgREST and Realtime) =====
INSERT INTO public.t_results SELECT 'rr: members cannot SELECT messages.read_at (PostgREST and Realtime both honour this)',
  NOT has_column_privilege('authenticated', 'public.messages', 'read_at', 'SELECT')
    AND NOT has_column_privilege('anon', 'public.messages', 'read_at', 'SELECT'), '';
INSERT INTO public.t_results SELECT 'rr: every other message column stays readable for members',
  bool_and(has_column_privilege('authenticated', 'public.messages', a.attname, 'SELECT')), string_agg(a.attname, ',')
FROM pg_attribute a WHERE a.attrelid = 'public.messages'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'read_at';

-- ===== B. Recipient reads the chat: marks read through the RPC =====
SET ROLE authenticated; SET request.jwt.claim.sub = '73000000-0000-0000-0000-00000000000b';
INSERT INTO public.t73 SELECT 'b_unread_before', jsonb_object_agg(s.match_id::text, s.unread_count) FROM public.get_chat_list_state() s;
INSERT INTO public.t73 VALUES ('b_mark_a1', to_jsonb(public.mark_chat_read('73aaaaaa-0000-0000-0000-0000000000a1')));
INSERT INTO public.t73 VALUES ('b_mark_a1_again', to_jsonb(public.mark_chat_read('73aaaaaa-0000-0000-0000-0000000000a1')));
SELECT public.mark_chat_read('73aaaaaa-0000-0000-0000-0000000000a2');
SELECT public.mark_chat_read('73aaaaaa-0000-0000-0000-0000000000a3');
SELECT public.mark_chat_read('73aaaaaa-0000-0000-0000-0000000000a4');
SELECT public.mark_chat_read('73aaaaaa-0000-0000-0000-0000000000a5');
INSERT INTO public.t73 SELECT 'b_unread_after', jsonb_object_agg(s.match_id::text, s.unread_count) FROM public.get_chat_list_state() s;
CALL public.expect_fail('rr: direct SELECT of read_at is refused for a recipient too',
  $q$SELECT read_at FROM public.messages WHERE match_id = '73aaaaaa-0000-0000-0000-0000000000a1'$q$);
CALL public.expect_fail('rr: filtering on read_at directly is refused (no oracle via WHERE)',
  $q$SELECT id FROM public.messages WHERE read_at IS NOT NULL$q$);
RESET ROLE;
INSERT INTO public.t_results SELECT 'rr: recipient unread count = 2 before reading (own messages never count)',
  (v->>'73aaaaaa-0000-0000-0000-0000000000a1')::int = 2, v::text FROM public.t73 WHERE k = 'b_unread_before';
INSERT INTO public.t_results SELECT 'rr: mark_chat_read marks only the other person''s messages, idempotently',
  (SELECT v FROM public.t73 WHERE k = 'b_mark_a1') = '2'::jsonb AND (SELECT v FROM public.t73 WHERE k = 'b_mark_a1_again') = '0'::jsonb
    AND (SELECT count(*) FROM public.messages WHERE match_id = '73aaaaaa-0000-0000-0000-0000000000a1'
         AND sender = '73000000-0000-0000-0000-00000000000b' AND read_at IS NOT NULL) = 0, '';
INSERT INTO public.t_results SELECT 'rr: unread is 0 after reading every chat',
  (SELECT bool_and((e.value)::int = 0) FROM jsonb_each_text(v) e), v::text FROM public.t73 WHERE k = 'b_unread_after';

-- ===== C. Senders: receipt visible only on Plus/VIP (RPCs) =====
CREATE FUNCTION public.t73_sender_view(_k text, _uid uuid, _match uuid, _msg uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  INSERT INTO public.t73 SELECT _k || '_rpc', to_jsonb(r.read_at) FROM public.get_match_messages(_match, 50) r WHERE r.id = _msg;
  INSERT INTO public.t73 SELECT _k || '_list', to_jsonb(s.last_message_read) FROM public.get_chat_list_state(ARRAY[_match]) s;
  PERFORM set_config('role', 'postgres', true);
END $$;
SELECT public.t73_sender_view('free', '73000000-0000-0000-0000-00000000000a', '73aaaaaa-0000-0000-0000-0000000000a1', '73eeeeee-0000-4000-8000-0000000000a1');
SELECT public.t73_sender_view('plus', '73000000-0000-0000-0000-00000000000c', '73aaaaaa-0000-0000-0000-0000000000a2', '73eeeeee-0000-4000-8000-0000000000c1');
SELECT public.t73_sender_view('vip', '73000000-0000-0000-0000-00000000000d', '73aaaaaa-0000-0000-0000-0000000000a3', '73eeeeee-0000-4000-8000-0000000000d1');
SELECT public.t73_sender_view('expired', '73000000-0000-0000-0000-00000000000e', '73aaaaaa-0000-0000-0000-0000000000a4', '73eeeeee-0000-4000-8000-0000000000e1');
SELECT public.t73_sender_view('premium', '73000000-0000-0000-0000-00000000000f', '73aaaaaa-0000-0000-0000-0000000000a5', '73eeeeee-0000-4000-8000-0000000000f1');

INSERT INTO public.t_results SELECT 'rr: free sender gets no read receipt (message RPC and chat list)',
  (SELECT v IS NULL FROM public.t73 WHERE k = 'free_rpc') AND (SELECT v IS NULL FROM public.t73 WHERE k = 'free_list'), '';
INSERT INTO public.t_results SELECT 'rr: premium (not Plus/VIP) sender gets no read receipt',
  (SELECT v IS NULL FROM public.t73 WHERE k = 'premium_rpc') AND (SELECT v IS NULL FROM public.t73 WHERE k = 'premium_list'), '';
INSERT INTO public.t_results SELECT 'rr: expired Plus sender gets no read receipt',
  (SELECT v IS NULL FROM public.t73 WHERE k = 'expired_rpc') AND (SELECT v IS NULL FROM public.t73 WHERE k = 'expired_list'), '';
INSERT INTO public.t_results SELECT 'rr: Plus sender sees the receipt (message RPC and chat list)',
  (SELECT v IS NOT NULL FROM public.t73 WHERE k = 'plus_rpc') AND (SELECT v FROM public.t73 WHERE k = 'plus_list') = 'true'::jsonb, '';
INSERT INTO public.t_results SELECT 'rr: VIP sender sees the receipt',
  (SELECT v IS NOT NULL FROM public.t73 WHERE k = 'vip_rpc') AND (SELECT v FROM public.t73 WHERE k = 'vip_list') = 'true'::jsonb, '';

-- Free sender: no path through the table either (direct, whole row, WHERE oracle).
SET ROLE authenticated; SET request.jwt.claim.sub = '73000000-0000-0000-0000-00000000000a';
CALL public.expect_fail('rr: free sender cannot read read_at from the table',
  $q$SELECT read_at FROM public.messages WHERE id = '73eeeeee-0000-4000-8000-0000000000a1'$q$);
CALL public.expect_fail('rr: free sender cannot read the whole row (select *)',
  $q$SELECT m.* FROM public.messages m WHERE id = '73eeeeee-0000-4000-8000-0000000000a1'$q$);
CALL public.expect_fail('rr: free sender cannot use read_at in a filter',
  $q$SELECT count(*) FROM public.messages WHERE id = '73eeeeee-0000-4000-8000-0000000000a1' AND read_at IS NULL$q$);
CALL public.expect_fail('rr: free sender cannot use read_at in RETURNING',
  $q$UPDATE public.messages SET body = body WHERE id = '73eeeeee-0000-4000-8000-0000000000a2' RETURNING read_at$q$);
INSERT INTO public.t73 SELECT 'free_cols', jsonb_build_object('body', body, 'delivered_at', delivered_at)
FROM public.messages WHERE id = '73eeeeee-0000-4000-8000-0000000000a1';
RESET ROLE;
INSERT INTO public.t_results SELECT 'rr: ordinary chat columns still readable by the free sender',
  v->>'body' = 'hi from free', v::text FROM public.t73 WHERE k = 'free_cols';

-- ===== D. Cross-user =====
SET ROLE authenticated; SET request.jwt.claim.sub = '73000000-0000-0000-0000-000000000011';
INSERT INTO public.t73 SELECT 'stranger_list', coalesce(jsonb_agg(s.match_id), '[]') FROM public.get_chat_list_state(ARRAY['73aaaaaa-0000-0000-0000-0000000000a2'::uuid]) s;
CALL public.expect_fail('rr: a non-member cannot mark someone else''s chat read',
  $q$SELECT public.mark_chat_read('73aaaaaa-0000-0000-0000-0000000000a2')$q$);
INSERT INTO public.t73 SELECT 'stranger_rows', to_jsonb(count(*)) FROM public.messages WHERE match_id = '73aaaaaa-0000-0000-0000-0000000000a2';
RESET ROLE;
SET ROLE anon;
CALL public.expect_fail('rr: anon cannot call get_chat_list_state', $q$SELECT * FROM public.get_chat_list_state()$q$);
CALL public.expect_fail('rr: anon cannot call mark_chat_read', $q$SELECT public.mark_chat_read('73aaaaaa-0000-0000-0000-0000000000a2')$q$);
RESET ROLE;
INSERT INTO public.t_results SELECT 'rr: a non-member gets no state for another person''s chat',
  v = '[]'::jsonb, v::text FROM public.t73 WHERE k = 'stranger_list';
INSERT INTO public.t_results SELECT 'rr: a non-member sees no messages of another person''s chat',
  v = '0'::jsonb, v::text FROM public.t73 WHERE k = 'stranger_rows';
INSERT INTO public.t_results SELECT 'rr: the Plus chat stayed read-marked only by its real recipient',
  (SELECT count(*) FROM public.messages WHERE match_id = '73aaaaaa-0000-0000-0000-0000000000a2' AND read_at IS NOT NULL) = 1, '';

-- ===== E. Blocking removes the chat from list state =====
INSERT INTO public.blocks(blocker, blocked) VALUES ('73000000-0000-0000-0000-00000000000b', '73000000-0000-0000-0000-00000000000f');
SET ROLE authenticated; SET request.jwt.claim.sub = '73000000-0000-0000-0000-00000000000f';
INSERT INTO public.t73 SELECT 'blocked_list', coalesce(jsonb_agg(s.match_id), '[]') FROM public.get_chat_list_state() s;
RESET ROLE;
INSERT INTO public.t_results SELECT 'rr: a blocked pair''s chat returns no state',
  v = '[]'::jsonb, v::text FROM public.t73 WHERE k = 'blocked_list';
