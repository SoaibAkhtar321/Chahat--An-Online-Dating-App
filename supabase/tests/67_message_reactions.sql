\set ON_ERROR_STOP on
-- 67_message_reactions.sql: emoji reactions (migration 20260101004800). Runs after 10_functional_rls.sql (uses
-- public.t_results, expect_fail, test_complete_profile). Fixtures: U1 and U2 are members of match M, U3 is a stranger.
-- m1 (U1), m2 (U2): plain; m3 (U1): later deleted for everyone; m4 (U2): later deleted for me by U1 only.

\o /dev/null
CREATE TABLE public.t67(k text PRIMARY KEY, v jsonb);
GRANT ALL ON public.t67 TO PUBLIC;
CREATE OR REPLACE FUNCTION public.t67_check(_name text, _ok boolean, _detail text DEFAULT '') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results VALUES (_name, coalesce(_ok, false), _detail)
$$;

INSERT INTO auth.users(id, email) VALUES
 ('f6700000-0000-0000-0000-000000000001','rx-1@x'), ('f6700000-0000-0000-0000-000000000002','rx-2@x'), ('f6700000-0000-0000-0000-000000000003','rx-3@x');
CALL public.test_complete_profile('f6700000-0000-0000-0000-000000000001','RxOne','1995-01-01','man','woman');
CALL public.test_complete_profile('f6700000-0000-0000-0000-000000000002','RxTwo','1995-01-01','woman','man');
CALL public.test_complete_profile('f6700000-0000-0000-0000-000000000003','RxThree','1995-01-01','man','woman');
INSERT INTO public.matches(id, user_a, user_b) VALUES ('f6760000-0000-4000-8000-000000000001','f6700000-0000-0000-0000-000000000001','f6700000-0000-0000-0000-000000000002');
INSERT INTO public.messages(id, match_id, sender, body, message_type, created_at) VALUES
 ('f6770000-0000-4000-8000-000000000001','f6760000-0000-4000-8000-000000000001','f6700000-0000-0000-0000-000000000001','one','text', now()-interval '50 min'),
 ('f6770000-0000-4000-8000-000000000002','f6760000-0000-4000-8000-000000000001','f6700000-0000-0000-0000-000000000002','two','text', now()-interval '49 min'),
 ('f6770000-0000-4000-8000-000000000003','f6760000-0000-4000-8000-000000000001','f6700000-0000-0000-0000-000000000001','three','text', now()-interval '48 min'),
 ('f6770000-0000-4000-8000-000000000004','f6760000-0000-4000-8000-000000000001','f6700000-0000-0000-0000-000000000002','four','text', now()-interval '47 min');
\o

-- ===== A. Structure and lock-down ====================================================================================
SELECT public.t67_check('rx: table exists with RLS enabled',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.message_reactions'::regclass));
SELECT public.t67_check('rx: clients cannot write the table directly (no INSERT/UPDATE/DELETE grant)',
  NOT has_table_privilege('authenticated', 'public.message_reactions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.message_reactions', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.message_reactions', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.message_reactions', 'SELECT')
  AND has_table_privilege('authenticated', 'public.message_reactions', 'SELECT'));
SELECT public.t67_check('rx: the RPC is not executable by anon',
  NOT has_function_privilege('anon', 'public.set_message_reaction(uuid, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.set_message_reaction(uuid, text)', 'EXECUTE'));

SET ROLE anon;
CALL public.expect_fail('rx: anon cannot call set_message_reaction', $q$SELECT public.set_message_reaction('f6770000-0000-4000-8000-000000000001', '👍')$q$);
RESET ROLE;

SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
CALL public.expect_fail('rx: a member cannot INSERT a reaction row directly', $q$INSERT INTO public.message_reactions(message_id, user_id, match_id, emoji) VALUES ('f6770000-0000-4000-8000-000000000001', 'f6700000-0000-0000-0000-000000000002', 'f6760000-0000-4000-8000-000000000001', '👍')$q$);
RESET ROLE;
SELECT public.t67_check('rx: no row was created by the direct INSERT attempt', (SELECT count(*) FROM public.message_reactions) = 0);

-- ===== B. Reacting ===================================================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'r1', public.set_message_reaction('f6770000-0000-4000-8000-000000000001', '👍');
RESET ROLE;
SELECT public.t67_check('rx: a member can react to the partner''s message',
  (SELECT (v->>'success')::boolean FROM public.t67 WHERE k='r1')
  AND (SELECT emoji FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000001' AND user_id='f6700000-0000-0000-0000-000000000002') = '👍'
  AND (SELECT match_id FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000001' AND user_id='f6700000-0000-0000-0000-000000000002') = 'f6760000-0000-4000-8000-000000000001');

SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'r2', public.set_message_reaction('f6770000-0000-4000-8000-000000000001', '❤️');
RESET ROLE;
SELECT public.t67_check('rx: a member can react to their own message too',
  (SELECT (v->>'success')::boolean FROM public.t67 WHERE k='r2')
  AND (SELECT count(*) FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000001' AND emoji IS NOT NULL) = 2);

-- one reaction per person per message: a new emoji replaces the old one
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'r3', public.set_message_reaction('f6770000-0000-4000-8000-000000000001', '😂');
RESET ROLE;
SELECT public.t67_check('rx: reacting again replaces the previous emoji (still one row per user per message)',
  (SELECT count(*) FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000001' AND user_id='f6700000-0000-0000-0000-000000000002') = 1
  AND (SELECT emoji FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000001' AND user_id='f6700000-0000-0000-0000-000000000002') = '😂');

-- the same emoji twice changes nothing
INSERT INTO public.t67 SELECT 'ts_before', to_jsonb(updated_at::text) FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000001' AND user_id='f6700000-0000-0000-0000-000000000002';
SELECT pg_sleep(0.05);
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
SELECT public.set_message_reaction('f6770000-0000-4000-8000-000000000001', '😂');
RESET ROLE;
SELECT public.t67_check('rx: repeating the same emoji is a no-op (updated_at unchanged)',
  (SELECT updated_at::text FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000001' AND user_id='f6700000-0000-0000-0000-000000000002') = (SELECT v #>> '{}' FROM public.t67 WHERE k='ts_before'));

-- whitespace around the emoji is tolerated
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'r_ws', public.set_message_reaction('f6770000-0000-4000-8000-000000000002', '  🙏  ');
RESET ROLE;
SELECT public.t67_check('rx: surrounding whitespace is trimmed',
  (SELECT emoji FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000002' AND user_id='f6700000-0000-0000-0000-000000000002') = '🙏');

-- ===== C. Only the fixed emoji set is accepted ==============================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'bad1', public.set_message_reaction('f6770000-0000-4000-8000-000000000002', '🍕');
INSERT INTO public.t67 SELECT 'bad2', public.set_message_reaction('f6770000-0000-4000-8000-000000000002', 'hello there, this is a message');
INSERT INTO public.t67 SELECT 'bad3', public.set_message_reaction('f6770000-0000-4000-8000-000000000002', '👍👍');
RESET ROLE;
SELECT public.t67_check('rx: anything outside the fixed set is refused and changes nothing',
  (SELECT v->>'error' FROM public.t67 WHERE k='bad1') = 'invalid_reaction'
  AND (SELECT v->>'error' FROM public.t67 WHERE k='bad2') = 'invalid_reaction'
  AND (SELECT v->>'error' FROM public.t67 WHERE k='bad3') = 'invalid_reaction'
  AND (SELECT emoji FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000002' AND user_id='f6700000-0000-0000-0000-000000000002') = '🙏');
SELECT public.t67_check('rx: the database CHECK also rejects a non-allowed emoji (defence in depth)',
  (SELECT count(*) FROM pg_constraint WHERE conrelid='public.message_reactions'::regclass AND conname='message_reactions_emoji_allowed') = 1);

-- ===== D. Removing ===================================================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'rm1', public.set_message_reaction('f6770000-0000-4000-8000-000000000002', NULL);
INSERT INTO public.t67 SELECT 'rm2', public.set_message_reaction('f6770000-0000-4000-8000-000000000002', '');
INSERT INTO public.t67 SELECT 'rm_never', public.set_message_reaction('f6770000-0000-4000-8000-000000000004', NULL);
RESET ROLE;
SELECT public.t67_check('rx: removing empties the emoji but keeps the row (so Realtime can announce it); repeats are harmless',
  (SELECT (v->>'success')::boolean FROM public.t67 WHERE k='rm1')
  AND (SELECT (v->>'success')::boolean FROM public.t67 WHERE k='rm2')
  AND (SELECT (v->>'success')::boolean FROM public.t67 WHERE k='rm_never')
  AND (SELECT emoji IS NULL FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000002' AND user_id='f6700000-0000-0000-0000-000000000002')
  AND (SELECT count(*) FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000002') = 1);
SELECT public.t67_check('rx: removing a reaction that never existed creates no row',
  (SELECT count(*) FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000004') = 0);

-- ===== E. Who can act and who can read ================================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000003'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'stranger', public.set_message_reaction('f6770000-0000-4000-8000-000000000001', '👍');
INSERT INTO public.t67 SELECT 'stranger_seen', to_jsonb((SELECT count(*) FROM public.message_reactions));
RESET ROLE;
SELECT public.t67_check('rx: a stranger can neither react nor read reactions',
  (SELECT v->>'error' FROM public.t67 WHERE k='stranger') = 'message_not_found'
  AND (SELECT (v)::int FROM public.t67 WHERE k='stranger_seen') = 0
  AND (SELECT count(*) FROM public.message_reactions WHERE user_id='f6700000-0000-0000-0000-000000000003') = 0);

SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'member_seen', to_jsonb((SELECT count(*) FROM public.message_reactions WHERE match_id='f6760000-0000-4000-8000-000000000001' AND emoji IS NOT NULL));
RESET ROLE;
SELECT public.t67_check('rx: a member reads the live reactions of their match',
  (SELECT (v)::int FROM public.t67 WHERE k='member_seen') = 2);

SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'unknown_msg', public.set_message_reaction('f67700ff-0000-4000-8000-0000000000ff', '👍');
RESET ROLE;
SELECT public.t67_check('rx: an unknown message id is refused', (SELECT v->>'error' FROM public.t67 WHERE k='unknown_msg') = 'message_not_found');

-- suspended account cannot react
SET request.jwt.claim.role='service_role'; UPDATE public.profiles SET status = 'suspended' WHERE id = 'f6700000-0000-0000-0000-000000000002'; RESET request.jwt.claim.role;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'suspended_status', to_jsonb((SELECT status FROM public.profiles WHERE id = 'f6700000-0000-0000-0000-000000000002'));
INSERT INTO public.t67 SELECT 'suspended', public.set_message_reaction('f6770000-0000-4000-8000-000000000001', '🙏');
RESET ROLE;
SET request.jwt.claim.role='service_role'; UPDATE public.profiles SET status = 'active' WHERE id = 'f6700000-0000-0000-0000-000000000002'; RESET request.jwt.claim.role;
SELECT public.t67_check('rx: a suspended account cannot react',
  (SELECT v #>> '{}' FROM public.t67 WHERE k='suspended_status') = 'suspended'
  AND (SELECT v->>'error' FROM public.t67 WHERE k='suspended') = 'account_suspended'
  AND (SELECT emoji FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000001' AND user_id='f6700000-0000-0000-0000-000000000002') = '😂');

-- ===== F. Deleted messages ============================================================================================
-- delete for me: U1 hides m4; U1 cannot react to it and cannot see reactions on it, U2 still can
INSERT INTO public.message_reactions(message_id, user_id, match_id, emoji) VALUES ('f6770000-0000-4000-8000-000000000004', 'f6700000-0000-0000-0000-000000000002', 'f6760000-0000-4000-8000-000000000001', '👍');
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
SELECT public.delete_message_for_me('f6770000-0000-4000-8000-000000000004');
INSERT INTO public.t67 SELECT 'hidden_react', public.set_message_reaction('f6770000-0000-4000-8000-000000000004', '❤️');
INSERT INTO public.t67 SELECT 'hidden_seen', to_jsonb((SELECT count(*) FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000004'));
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'visible_seen', to_jsonb((SELECT count(*) FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000004'));
RESET ROLE;
SELECT public.t67_check('rx: a message deleted for me cannot be reacted to and its reactions stay hidden from me only',
  (SELECT v->>'error' FROM public.t67 WHERE k='hidden_react') = 'message_not_found'
  AND (SELECT (v)::int FROM public.t67 WHERE k='hidden_seen') = 0
  AND (SELECT (v)::int FROM public.t67 WHERE k='visible_seen') = 1);

-- delete for everyone: reactions are cleared and the message can no longer be reacted to
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
SELECT public.set_message_reaction('f6770000-0000-4000-8000-000000000003', '😮');
RESET ROLE;
SELECT public.t67_check('rx: (setup) m3 has a reaction before it is deleted',
  (SELECT emoji FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000003' AND user_id='f6700000-0000-0000-0000-000000000002') = '😮');
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
SELECT public.delete_message_for_everyone('f6770000-0000-4000-8000-000000000003');
RESET ROLE;
SELECT public.t67_check('rx: deleting for everyone empties the message''s reactions',
  (SELECT count(*) FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000003' AND emoji IS NOT NULL) = 0);
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6700000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t67 SELECT 'tomb_react', public.set_message_reaction('f6770000-0000-4000-8000-000000000003', '😮');
INSERT INTO public.t67 SELECT 'tomb_seen', to_jsonb((SELECT count(*) FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000003'));
RESET ROLE;
SELECT public.t67_check('rx: a deleted-for-everyone message cannot be reacted to and shows no reactions',
  (SELECT v->>'error' FROM public.t67 WHERE k='tomb_react') = 'message_not_found'
  AND (SELECT (v)::int FROM public.t67 WHERE k='tomb_seen') = 0);

-- ===== G. Cleanup cascades ==============================================================================================
DELETE FROM public.messages WHERE id = 'f6770000-0000-4000-8000-000000000001';
SELECT public.t67_check('rx: deleting a message removes its reactions',
  (SELECT count(*) FROM public.message_reactions WHERE message_id='f6770000-0000-4000-8000-000000000001') = 0);
DELETE FROM public.matches WHERE id = 'f6760000-0000-4000-8000-000000000001';
SELECT public.t67_check('rx: unmatching removes every reaction of the chat',
  (SELECT count(*) FROM public.message_reactions WHERE match_id='f6760000-0000-4000-8000-000000000001') = 0);
