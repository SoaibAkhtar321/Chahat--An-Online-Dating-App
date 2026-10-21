\set ON_ERROR_STOP on
-- 68_message_replies.sql: reply to a specific message (migration 20260101004900). Runs after 10_functional_rls.sql
-- (uses public.t_results, expect_fail, test_complete_profile).
-- Fixtures: U1 and U2 are members of match M1, U1 and U3 of match M2. U4 is a stranger to both.
--   a1 (U1, text)    : replied to by U2 (r1)           b1 (U2, long text, 200 chars)
--   a2 (U2, image)   : original that is a photo         a3 (U1, view-once photo)       a4 (U2, voice)
--   h1 (U1)          : later deleted FOR ME by U1       e1 (U1) : later deleted FOR EVERYONE
--   x1 (U3 in M2)    : message of another chat

\o /dev/null
CREATE TABLE public.t68(k text PRIMARY KEY, v jsonb);
GRANT ALL ON public.t68 TO PUBLIC;
CREATE OR REPLACE FUNCTION public.t68_check(_name text, _ok boolean, _detail text DEFAULT '') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results VALUES (_name, coalesce(_ok, false), _detail)
$$;
-- one preview row of a message, as the caller sees it through get_match_messages
CREATE OR REPLACE FUNCTION public.t68_row(_match uuid, _msg uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(g) FROM public.get_match_messages(_match, 100) g WHERE g.id = _msg
$$;
GRANT EXECUTE ON FUNCTION public.t68_row(uuid, uuid) TO PUBLIC;

INSERT INTO auth.users(id, email) VALUES
 ('f6800000-0000-0000-0000-000000000001','rp-1@x'), ('f6800000-0000-0000-0000-000000000002','rp-2@x'),
 ('f6800000-0000-0000-0000-000000000003','rp-3@x'), ('f6800000-0000-0000-0000-000000000004','rp-4@x');
CALL public.test_complete_profile('f6800000-0000-0000-0000-000000000001','RpOne','1995-01-01','man','woman');
CALL public.test_complete_profile('f6800000-0000-0000-0000-000000000002','RpTwo','1995-01-01','woman','man');
CALL public.test_complete_profile('f6800000-0000-0000-0000-000000000003','RpThree','1995-01-01','woman','man');
CALL public.test_complete_profile('f6800000-0000-0000-0000-000000000004','RpFour','1995-01-01','man','woman');
INSERT INTO public.matches(id, user_a, user_b) VALUES
 ('f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','f6800000-0000-0000-0000-000000000002'),
 ('f6860000-0000-4000-8000-000000000002','f6800000-0000-0000-0000-000000000001','f6800000-0000-0000-0000-000000000003');
INSERT INTO public.messages(id, match_id, sender, body, message_type, image_path, audio_path, audio_duration_sec, is_view_once, created_at) VALUES
 ('f6870000-0000-4000-8000-0000000000a1','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','hello there','text', NULL, NULL, NULL, false, now()-interval '60 min'),
 ('f6870000-0000-4000-8000-0000000000a2','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000002','secret caption','image','f6860000-0000-4000-8000-000000000001/a2.jpg', NULL, NULL, false, now()-interval '59 min'),
 ('f6870000-0000-4000-8000-0000000000a3','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','view once caption','image','f6860000-0000-4000-8000-000000000001/a3.jpg', NULL, NULL, true, now()-interval '58 min'),
 ('f6870000-0000-4000-8000-0000000000a4','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000002','Voice message','voice', NULL,'f6860000-0000-4000-8000-000000000001/voice_a4.m4a', 7, false, now()-interval '57 min'),
 ('f6870000-0000-4000-8000-0000000000b1','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000002', repeat('x', 200),'text', NULL, NULL, NULL, false, now()-interval '56 min'),
 ('f6870000-0000-4000-8000-0000000000c1','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','to be hidden','text', NULL, NULL, NULL, false, now()-interval '55 min'),
 ('f6870000-0000-4000-8000-0000000000e1','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','to be deleted for everyone','text', NULL, NULL, NULL, false, now()-interval '54 min'),
 ('f6870000-0000-4000-8000-0000000000f1','f6860000-0000-4000-8000-000000000002','f6800000-0000-0000-0000-000000000003','other chat','text', NULL, NULL, NULL, false, now()-interval '53 min');
\o

-- ===== A. Structure ==================================================================================================
SELECT public.t68_check('rp: messages.reply_to_id exists',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' AND column_name='reply_to_id'));
SELECT public.t68_check('rp: validate and guard triggers exist',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.messages'::regclass AND tgname IN ('messages_reply_validate','messages_reply_guard') AND NOT tgisinternal) = 2);
SELECT public.t68_check('rp: get_match_messages stays executable by members only (not anon)',
  NOT has_function_privilege('anon', 'public.get_match_messages(uuid, integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_match_messages(uuid, integer)', 'EXECUTE'));
SELECT public.t68_check('rp: only one get_match_messages overload exists',
  (SELECT count(*) FROM pg_proc WHERE proname='get_match_messages' AND pronamespace='public'::regnamespace) = 1);

-- ===== B. Sending a reply ============================================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.messages(id, match_id, sender, body, message_type, reply_to_id)
VALUES ('f6870000-0000-4000-8000-0000000000d1','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000002','hi back','text','f6870000-0000-4000-8000-0000000000a1');
RESET ROLE;
SELECT public.t68_check('rp: a member can reply to a message of the same chat',
  (SELECT reply_to_id FROM public.messages WHERE id='f6870000-0000-4000-8000-0000000000d1') = 'f6870000-0000-4000-8000-0000000000a1');

SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t68 SELECT 'prev_u1', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d1');
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t68 SELECT 'prev_u2', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d1');
RESET ROLE;
SELECT public.t68_check('rp: both members get the quoted preview (sender, text, kind) from get_match_messages',
  (SELECT v->>'reply_to_id' FROM public.t68 WHERE k='prev_u1') = 'f6870000-0000-4000-8000-0000000000a1'
  AND (SELECT v->>'reply_sender' FROM public.t68 WHERE k='prev_u1') = 'f6800000-0000-0000-0000-000000000001'
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='prev_u1') = 'hello there'
  AND (SELECT v->>'reply_kind' FROM public.t68 WHERE k='prev_u1') = 'text'
  AND (SELECT (v->>'reply_unavailable')::boolean FROM public.t68 WHERE k='prev_u1') = false
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='prev_u2') = 'hello there');

SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t68 SELECT 'plain', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000a1');
RESET ROLE;
SELECT public.t68_check('rp: a message that is not a reply has no preview and is not "unavailable"',
  (SELECT v->>'reply_to_id' FROM public.t68 WHERE k='plain') IS NULL
  AND (SELECT (v->>'reply_unavailable')::boolean FROM public.t68 WHERE k='plain') = false
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='plain') IS NULL);

-- ===== C. A reply must point at a visible message of the same chat ===================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
CALL public.expect_fail('rp: cannot reply to a message of another chat',
  $q$INSERT INTO public.messages(match_id, sender, body, message_type, reply_to_id) VALUES ('f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','x','text','f6870000-0000-4000-8000-0000000000f1')$q$);
CALL public.expect_fail('rp: cannot reply to a message that does not exist',
  $q$INSERT INTO public.messages(match_id, sender, body, message_type, reply_to_id) VALUES ('f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','x','text','f68700ff-0000-4000-8000-0000000000ff')$q$);
RESET ROLE;
SELECT public.t68_check('rp: the refused replies were not stored',
  (SELECT count(*) FROM public.messages WHERE body = 'x' AND match_id = 'f6860000-0000-4000-8000-000000000001') = 0);

SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000004'; SET request.jwt.claim.role = 'authenticated';
CALL public.expect_fail('rp: a stranger cannot send into the chat at all (reply or not)',
  $q$INSERT INTO public.messages(match_id, sender, body, message_type, reply_to_id) VALUES ('f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000004','x','text','f6870000-0000-4000-8000-0000000000a1')$q$);
CALL public.expect_fail('rp: a stranger cannot read the chat through get_match_messages',
  $q$SELECT * FROM public.get_match_messages('f6860000-0000-4000-8000-000000000001', 50)$q$);
RESET ROLE;

SELECT public.t68_check('rp: a message cannot reply to itself (CHECK)',
  (SELECT count(*) FROM pg_constraint WHERE conrelid='public.messages'::regclass AND conname='messages_reply_not_self') = 1);

-- ===== D. reply_to_id is write-once for clients =======================================================================
-- U1 is the recipient of d1 and may UPDATE it (read receipts), but not rewrite the reply link.
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
UPDATE public.messages SET reply_to_id = NULL, read_at = now() WHERE id = 'f6870000-0000-4000-8000-0000000000d1';
UPDATE public.messages SET reply_to_id = 'f6870000-0000-4000-8000-0000000000a2' WHERE id = 'f6870000-0000-4000-8000-0000000000d1';
RESET ROLE;
SELECT public.t68_check('rp: a client UPDATE cannot change or clear reply_to_id (read receipt update still works)',
  (SELECT reply_to_id FROM public.messages WHERE id='f6870000-0000-4000-8000-0000000000d1') = 'f6870000-0000-4000-8000-0000000000a1'
  AND (SELECT read_at IS NOT NULL FROM public.messages WHERE id='f6870000-0000-4000-8000-0000000000d1'));

-- ===== E. Preview never leaks media or hidden text =====================================================================
INSERT INTO public.messages(id, match_id, sender, body, message_type, reply_to_id) VALUES
 ('f6870000-0000-4000-8000-0000000000d2','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','nice photo','text','f6870000-0000-4000-8000-0000000000a2'),
 ('f6870000-0000-4000-8000-0000000000d3','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000002','view once reply','text','f6870000-0000-4000-8000-0000000000a3'),
 ('f6870000-0000-4000-8000-0000000000d4','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','voice reply','text','f6870000-0000-4000-8000-0000000000a4'),
 ('f6870000-0000-4000-8000-0000000000d5','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','long reply','text','f6870000-0000-4000-8000-0000000000b1');
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t68 SELECT 'img', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d2');
INSERT INTO public.t68 SELECT 'vo', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d3');
INSERT INTO public.t68 SELECT 'voice', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d4');
INSERT INTO public.t68 SELECT 'long', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d5');
RESET ROLE;
SELECT public.t68_check('rp: replying to a photo shows kind "image" with no caption text and no media path',
  (SELECT v->>'reply_kind' FROM public.t68 WHERE k='img') = 'image'
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='img') IS NULL
  AND NOT ((SELECT v::text FROM public.t68 WHERE k='img') LIKE '%a2.jpg%' AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='img') IS NOT NULL));
SELECT public.t68_check('rp: replying to a view-once photo exposes no text of it',
  (SELECT v->>'reply_kind' FROM public.t68 WHERE k='vo') = 'image'
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='vo') IS NULL);
SELECT public.t68_check('rp: replying to a voice note shows kind "voice" and no text',
  (SELECT v->>'reply_kind' FROM public.t68 WHERE k='voice') = 'voice'
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='voice') IS NULL);
SELECT public.t68_check('rp: a long original is cut to 120 characters in the preview',
  length((SELECT v->>'reply_body' FROM public.t68 WHERE k='long')) = 120);

-- ===== F. Delete for me ==================================================================================================
INSERT INTO public.messages(id, match_id, sender, body, message_type, reply_to_id) VALUES
 ('f6870000-0000-4000-8000-0000000000d6','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000002','reply to c1','text','f6870000-0000-4000-8000-0000000000c1');
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
SELECT public.delete_message_for_me('f6870000-0000-4000-8000-0000000000c1');
INSERT INTO public.t68 SELECT 'hid_u1', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d6');
CALL public.expect_fail('rp: a message I deleted for me can no longer be replied to by me',
  $q$INSERT INTO public.messages(match_id, sender, body, message_type, reply_to_id) VALUES ('f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','x','text','f6870000-0000-4000-8000-0000000000c1')$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t68 SELECT 'hid_u2', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d6');
RESET ROLE;
SELECT public.t68_check('rp: for the person who deleted the original it shows as unavailable, with no text',
  (SELECT (v->>'reply_unavailable')::boolean FROM public.t68 WHERE k='hid_u1') = true
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='hid_u1') IS NULL
  AND (SELECT v->>'reply_sender' FROM public.t68 WHERE k='hid_u1') IS NULL);
SELECT public.t68_check('rp: the partner still sees the original in the quote (delete for me is private)',
  (SELECT (v->>'reply_unavailable')::boolean FROM public.t68 WHERE k='hid_u2') = false
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='hid_u2') = 'to be hidden');

-- ===== G. Delete for everyone ============================================================================================
INSERT INTO public.messages(id, match_id, sender, body, message_type, reply_to_id) VALUES
 ('f6870000-0000-4000-8000-0000000000d7','f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000002','reply to e1','text','f6870000-0000-4000-8000-0000000000e1');
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
SELECT public.delete_message_for_everyone('f6870000-0000-4000-8000-0000000000e1');
INSERT INTO public.t68 SELECT 'tomb_u1', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d7');
CALL public.expect_fail('rp: a message deleted for everyone can no longer be replied to',
  $q$INSERT INTO public.messages(match_id, sender, body, message_type, reply_to_id) VALUES ('f6860000-0000-4000-8000-000000000001','f6800000-0000-0000-0000-000000000001','x','text','f6870000-0000-4000-8000-0000000000e1')$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t68 SELECT 'tomb_u2', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d7');
RESET ROLE;
SELECT public.t68_check('rp: when the original is deleted for everyone the quote becomes unavailable for both, with no text',
  (SELECT (v->>'reply_unavailable')::boolean FROM public.t68 WHERE k='tomb_u1') = true
  AND (SELECT (v->>'reply_unavailable')::boolean FROM public.t68 WHERE k='tomb_u2') = true
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='tomb_u1') IS NULL
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='tomb_u2') IS NULL
  AND (SELECT v->>'reply_sender' FROM public.t68 WHERE k='tomb_u2') IS NULL);

-- a reply that is itself deleted for everyone carries no preview at all
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6800000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
SELECT public.delete_message_for_everyone('f6870000-0000-4000-8000-0000000000d1');
INSERT INTO public.t68 SELECT 'tomb_reply', public.t68_row('f6860000-0000-4000-8000-000000000001','f6870000-0000-4000-8000-0000000000d1');
RESET ROLE;
SELECT public.t68_check('rp: a reply deleted for everyone returns no text and no preview',
  (SELECT v->>'body' FROM public.t68 WHERE k='tomb_reply') = ''
  AND (SELECT v->>'reply_to_id' FROM public.t68 WHERE k='tomb_reply') IS NULL
  AND (SELECT v->>'reply_body' FROM public.t68 WHERE k='tomb_reply') IS NULL
  AND (SELECT (v->>'reply_unavailable')::boolean FROM public.t68 WHERE k='tomb_reply') = false);

-- ===== H. Cleanup ========================================================================================================
-- Hard-deleting the original (service role) clears the link instead of failing, even with the client guard in place.
DELETE FROM public.messages WHERE id = 'f6870000-0000-4000-8000-0000000000a1';
SELECT public.t68_check('rp: hard-deleting an original just clears the reply link (ON DELETE SET NULL)',
  (SELECT count(*) FROM public.messages WHERE id='f6870000-0000-4000-8000-0000000000d1') = 1
  AND (SELECT reply_to_id FROM public.messages WHERE id='f6870000-0000-4000-8000-0000000000d1') IS NULL);

DELETE FROM public.matches WHERE id IN ('f6860000-0000-4000-8000-000000000001','f6860000-0000-4000-8000-000000000002');
SELECT public.t68_check('rp: unmatching removes the whole chat including replies',
  (SELECT count(*) FROM public.messages WHERE match_id IN ('f6860000-0000-4000-8000-000000000001','f6860000-0000-4000-8000-000000000002')) = 0);
