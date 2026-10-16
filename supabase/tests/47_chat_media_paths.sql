\set ON_ERROR_STOP on
-- Chat media path authorization (image_path / audio_path).
-- Runs after 44_voice_messages.sql (reuses users 80000000-...-a/b/c and match ...a1).
-- Rejections must be RLS (42501) or CHECK (23514) violations, never an incidental error.

CREATE OR REPLACE PROCEDURE public.expect_path_rejected(_name text, _sql text) LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE _sql;
    INSERT INTO public.t_results VALUES(_name, false, 'succeeded but should fail');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    INSERT INTO public.t_results VALUES(_name, true, SQLERRM);
  WHEN OTHERS THEN
    INSERT INTO public.t_results VALUES(_name, false, 'failed for the wrong reason: ' || SQLSTATE || ' ' || SQLERRM);
  END;
END $$;
GRANT EXECUTE ON PROCEDURE public.expect_path_rejected(text,text) TO PUBLIC;

-- A is a member of a1 (with B) and a2 (with C). a3 is B<->C only; A is NOT a member.
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('eeeeeeee-0000-0000-0000-0000000000a2', '80000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-00000000000c'),
  ('eeeeeeee-0000-0000-0000-0000000000a3', '80000000-0000-0000-0000-00000000000b', '80000000-0000-0000-0000-00000000000c');

SET ROLE authenticated;
SET request.jwt.claim.sub = '80000000-0000-0000-0000-00000000000a';

-- ---------- legitimate messages still work ----------
CALL public.expect_ok('media path: image inside own match folder accepted',
  $q$INSERT INTO public.messages(match_id,sender,image_path,message_type) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/6f1d2c3a-0000-4000-8000-000000000001.jpg','image')$q$);
CALL public.expect_ok('media path: image with caption and default type accepted (client shape)',
  $q$INSERT INTO public.messages(match_id,sender,body,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','look','eeeeeeee-0000-0000-0000-0000000000a1/6f1d2c3a-0000-4000-8000-000000000002.png')$q$);
CALL public.expect_ok('media path: voice inside own match folder accepted',
  $q$INSERT INTO public.messages(match_id,sender,audio_path,audio_duration_sec,message_type) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/voice_6f1d2c3a-0000-4000-8000-000000000003.m4a',5,'voice')$q$);
CALL public.expect_ok('media path: image accepted in a second match the sender belongs to',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a2','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a2/ok.jpg')$q$);

-- ---------- image_path rejections ----------
CALL public.expect_path_rejected('media path: image in another match folder (member of both) rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a2/x.jpg')$q$);
CALL public.expect_path_rejected('media path: image in a match the sender is not in (path) rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a3/x.jpg')$q$);
CALL public.expect_path_rejected('media path: message into unauthorized match with its own folder rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a3','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a3/x.jpg')$q$);
CALL public.expect_path_rejected('media path: bare relative folder name rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','other-match/x.jpg')$q$);
CALL public.expect_path_rejected('media path: traversal into sibling match rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/../eeeeeeee-0000-0000-0000-0000000000a3/x.jpg')$q$);
CALL public.expect_path_rejected('media path: traversal with ../../ rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/../../x.jpg')$q$);
CALL public.expect_path_rejected('media path: dot-dot inside file name rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/a..b.jpg')$q$);
CALL public.expect_path_rejected('media path: nested sub-folder rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/sub/x.jpg')$q$);
CALL public.expect_path_rejected('media path: leading slash rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','/eeeeeeee-0000-0000-0000-0000000000a1/x.jpg')$q$);
CALL public.expect_path_rejected('media path: backslash separator rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1\x.jpg')$q$);
CALL public.expect_path_rejected('media path: empty file name rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/')$q$);
CALL public.expect_path_rejected('media path: folder only, no slash, rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1')$q$);
CALL public.expect_path_rejected('media path: folder-prefix lookalike rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1x/x.jpg')$q$);
CALL public.expect_path_rejected('media path: url-encoded traversal characters rejected',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/%2e%2e%2fx.jpg')$q$);
CALL public.expect_path_rejected('media path: whitespace/newline in path rejected',
  format($q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a',%L)$q$, E'eeeeeeee-0000-0000-0000-0000000000a1/x.jpg\n'));

-- ---------- audio_path rejections ----------
CALL public.expect_path_rejected('media path: voice in another match folder rejected',
  $q$INSERT INTO public.messages(match_id,sender,audio_path,audio_duration_sec,message_type) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a2/voice_x.m4a',5,'voice')$q$);
CALL public.expect_path_rejected('media path: voice traversal rejected',
  $q$INSERT INTO public.messages(match_id,sender,audio_path,audio_duration_sec,message_type) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/../eeeeeeee-0000-0000-0000-0000000000a3/voice_x.m4a',5,'voice')$q$);
CALL public.expect_path_rejected('media path: valid image_path cannot smuggle a bad audio_path',
  $q$INSERT INTO public.messages(match_id,sender,image_path,audio_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/ok.jpg','eeeeeeee-0000-0000-0000-0000000000a3/x.m4a')$q$);

-- ---------- stranger (non-member) with a valid-looking path ----------
SET request.jwt.claim.sub = '80000000-0000-0000-0000-00000000000b';
CALL public.expect_path_rejected('media path: non-member cannot attach image to a match they are not in',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a2','80000000-0000-0000-0000-00000000000b','eeeeeeee-0000-0000-0000-0000000000a2/x.jpg')$q$);
CALL public.expect_path_rejected('media path: cannot send as another user even with a valid path',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a1/spoof.jpg')$q$);

-- ---------- UPDATE cannot repoint existing media ----------
SET request.jwt.claim.sub = '80000000-0000-0000-0000-00000000000a';
DO $$
DECLARE n int;
BEGIN
  UPDATE public.messages SET image_path = 'eeeeeeee-0000-0000-0000-0000000000a3/stolen.jpg'
   WHERE match_id = 'eeeeeeee-0000-0000-0000-0000000000a1' AND image_path LIKE '%/6f1d2c3a-0000-4000-8000-000000000001.jpg';
  RESET ROLE;
  INSERT INTO public.t_results
  SELECT 'media path: UPDATE cannot repoint image_path to another match',
         NOT EXISTS (SELECT 1 FROM public.messages WHERE image_path LIKE '%stolen.jpg'),
         'image_path unchanged';
END $$;

-- ---------- table CHECK applies to privileged writers too (RLS bypassed) ----------
RESET ROLE;
CALL public.expect_path_rejected('media path: CHECK blocks bad image_path even for superuser/service writers',
  $q$INSERT INTO public.messages(match_id,sender,image_path) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-0000000000a3/x.jpg')$q$);
CALL public.expect_path_rejected('media path: CHECK blocks bad audio_path even for superuser/service writers',
  $q$INSERT INTO public.messages(match_id,sender,audio_path,audio_duration_sec,message_type) VALUES ('eeeeeeee-0000-0000-0000-0000000000a1','80000000-0000-0000-0000-00000000000a','../x.m4a',5,'voice')$q$);

-- ---------- nothing bad was persisted ----------
INSERT INTO public.t_results
SELECT 'media path: no persisted message references a path outside its match folder',
       count(*) = 0, count(*)::text
FROM public.messages
WHERE (image_path IS NOT NULL AND NOT public.is_valid_chat_media_path(image_path, match_id))
   OR (audio_path IS NOT NULL AND NOT public.is_valid_chat_media_path(audio_path, match_id));
