\set ON_ERROR_STOP on
-- Phase 5: Voice Messages, Storage MIME Types, and Chat Security.
-- Runs after 10_functional_rls.sql (uses public.t_results, expect_fail, test_complete_profile).

-- ---------- Fixtures ----------
INSERT INTO auth.users(id, email) VALUES
  ('80000000-0000-0000-0000-00000000000a', 'voice-a@x'),  -- Match member A (sender)
  ('80000000-0000-0000-0000-00000000000b', 'voice-b@x'),  -- Match member B (recipient)
  ('80000000-0000-0000-0000-00000000000c', 'voice-c@x');  -- Stranger C (not in match)

CALL public.test_complete_profile('80000000-0000-0000-0000-00000000000a', 'VoiceA', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('80000000-0000-0000-0000-00000000000b', 'VoiceB', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('80000000-0000-0000-0000-00000000000c', 'VoiceC', '1995-01-01', 'man', 'woman');

INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('eeeeeeee-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-00000000000b');

-- ================= 1. Storage bucket configuration =================
INSERT INTO public.t_results
SELECT 'storage: chat bucket allows audio mime types and 5MB limit',
  EXISTS(
    SELECT 1 FROM storage.buckets
    WHERE id = 'chat'
      AND public = false
      AND file_size_limit = 5242880
      AND 'audio/m4a' = ANY(allowed_mime_types)
      AND 'audio/mp4' = ANY(allowed_mime_types)
      AND 'audio/aac' = ANY(allowed_mime_types)
  ),
  'Bucket chat has correct file size and audio MIME types';

-- ================= 2. Voice Message Sending & RLS =================
SET ROLE authenticated;
SET request.jwt.claim.sub = '80000000-0000-0000-0000-00000000000a';

-- Member A sends voice message to Match A1
INSERT INTO public.messages(id, match_id, sender, body, audio_path, audio_duration_sec, message_type)
VALUES (
  'eeeeeeee-0000-0000-0000-0000000000m1',
  'eeeeeeee-0000-0000-0000-0000000000a1',
  '80000000-0000-0000-0000-00000000000a',
  'Voice note',
  'eeeeeeee-0000-0000-0000-0000000000a1/voice_m1.m4a',
  15,
  'voice'
);

RESET ROLE;

INSERT INTO public.t_results
SELECT 'chat: member can insert voice message with audio_path and duration',
  EXISTS(
    SELECT 1 FROM public.messages
    WHERE id = 'eeeeeeee-0000-0000-0000-0000000000m1'
      AND message_type = 'voice'
      AND audio_path = 'eeeeeeee-0000-0000-0000-0000000000a1/voice_m1.m4a'
      AND audio_duration_sec = 15
  ),
  'Voice message inserted by participant';

-- Stranger C cannot insert into Match A1
SET ROLE authenticated;
SET request.jwt.claim.sub = '80000000-0000-0000-0000-00000000000c';

DO $$
BEGIN
  BEGIN
    INSERT INTO public.messages(id, match_id, sender, body, audio_path, audio_duration_sec, message_type)
    VALUES (
      'eeeeeeee-0000-0000-0000-0000000000m2',
      'eeeeeeee-0000-0000-0000-0000000000a1',
      '80000000-0000-0000-0000-00000000000c',
      'Intruder voice',
      'eeeeeeee-0000-0000-0000-0000000000a1/voice_m2.m4a',
      10,
      'voice'
    );
    RAISE EXCEPTION 'Stranger insert should have failed';
  EXCEPTION WHEN OTHERS THEN
    -- Expected failure under RLS
  END;
END $$;

RESET ROLE;

INSERT INTO public.t_results
SELECT 'chat: non-match participant is blocked from inserting voice messages',
  NOT EXISTS(
    SELECT 1 FROM public.messages WHERE id = 'eeeeeeee-0000-0000-0000-0000000000m2'
  ),
  'Stranger insertion rejected by RLS';

-- ================= 3. Schema CHECK Constraints =================
-- Invalid duration (> 300 seconds) must fail CHECK constraint
DO $$
BEGIN
  BEGIN
    INSERT INTO public.messages(id, match_id, sender, body, audio_path, audio_duration_sec, message_type)
    VALUES (
      'eeeeeeee-0000-0000-0000-0000000000m3',
      'eeeeeeee-0000-0000-0000-0000000000a1',
      '80000000-0000-0000-0000-00000000000a',
      'Long voice',
      'eeeeeeee-0000-0000-0000-0000000000a1/voice_m3.m4a',
      350,
      'voice'
    );
    RAISE EXCEPTION 'Exceeded duration should have failed check';
  EXCEPTION WHEN check_violation THEN
    -- Expected check constraint violation
  END;
END $$;

INSERT INTO public.t_results
SELECT 'chat: duration check rejects voice messages longer than 300 seconds',
  NOT EXISTS(
    SELECT 1 FROM public.messages WHERE id = 'eeeeeeee-0000-0000-0000-0000000000m3'
  ),
  'Duration check constraint enforced';

-- Invalid message_type must fail CHECK constraint
DO $$
BEGIN
  BEGIN
    INSERT INTO public.messages(id, match_id, sender, body, audio_path, audio_duration_sec, message_type)
    VALUES (
      'eeeeeeee-0000-0000-0000-0000000000m4',
      'eeeeeeee-0000-0000-0000-0000000000a1',
      '80000000-0000-0000-0000-00000000000a',
      'Bad type',
      NULL,
      NULL,
      'invalid_type'
    );
    RAISE EXCEPTION 'Invalid message_type should have failed check';
  EXCEPTION WHEN check_violation THEN
    -- Expected check constraint violation
  END;
END $$;

INSERT INTO public.t_results
SELECT 'chat: message_type check rejects unsupported message types',
  NOT EXISTS(
    SELECT 1 FROM public.messages WHERE id = 'eeeeeeee-0000-0000-0000-0000000000m4'
  ),
  'message_type check constraint enforced';

-- ================= 4. Mutation Guard Trigger =================
-- Updating message cannot mutate audio_path or message_type
UPDATE public.messages
SET audio_path = 'tampered_path.m4a',
    message_type = 'image',
    audio_duration_sec = 99
WHERE id = 'eeeeeeee-0000-0000-0000-0000000000m1';

INSERT INTO public.t_results
SELECT 'chat: messages_guard prevents mutating audio_path and message_type on UPDATE',
  EXISTS(
    SELECT 1 FROM public.messages
    WHERE id = 'eeeeeeee-0000-0000-0000-0000000000m1'
      AND audio_path = 'eeeeeeee-0000-0000-0000-0000000000a1/voice_m1.m4a'
      AND message_type = 'voice'
      AND audio_duration_sec = 15
  ),
  'messages_guard restored original columns on update';

-- ================= 5. RPC get_match_messages =================
SET ROLE authenticated;
SET request.jwt.claim.sub = '80000000-0000-0000-0000-00000000000a';

INSERT INTO public.t_results
SELECT 'chat: get_match_messages returns voice columns to participant',
  EXISTS(
    SELECT 1 FROM public.get_match_messages('eeeeeeee-0000-0000-0000-0000000000a1')
    WHERE id = 'eeeeeeee-0000-0000-0000-0000000000m1'
      AND message_type = 'voice'
      AND audio_duration_sec = 15
      AND audio_path = 'eeeeeeee-0000-0000-0000-0000000000a1/voice_m1.m4a'
  ),
  'RPC returns voice metadata';

RESET ROLE;
