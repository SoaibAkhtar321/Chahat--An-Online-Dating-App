-- Fixtures for 46_coin_concurrency.sh (concurrency database only).
-- Two eligible users with a match, and a free caller with an accepted call that is 45s in.
CREATE OR REPLACE PROCEDURE public.test_complete_profile(
  _uid uuid, _name text, _dob date, _gender text, _seeking text,
  _photo_name text DEFAULT 'test-profile.jpg'
) LANGUAGE plpgsql AS $$
DECLARE
  _path text := _uid::text || '/' || _photo_name;
BEGIN
  INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('photos', _path, _uid);
  UPDATE public.profiles
  SET name = _name, dob = _dob, gender = _gender, seeking = _seeking,
      city = 'Pune', bio = 'A complete test profile for database regressions.',
      intents = ARRAY['Friendship'], interests = ARRAY['Books', 'Coffee', 'Music'],
      photos = jsonb_build_array(jsonb_build_object('id', 'test-profile', 'path', _path, 'thumbPath', _path)),
      onboarded = true
  WHERE id = _uid::text;
END $$;

INSERT INTO app_settings (key, value) VALUES
  ('call_rate_audio_coins_per_minute', '4'::jsonb),
  ('call_rate_video_coins_per_minute', '10'::jsonb),
  ('call_free_seconds', '60'::jsonb),
  ('call_extension_lead_seconds', '20'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO auth.users(id, email) VALUES
  ('80000000-0000-0000-0000-00000000000a', 'coin-conc-a@x'),
  ('80000000-0000-0000-0000-00000000000b', 'coin-conc-b@x'),
  ('80000000-0000-0000-0000-00000000000c', 'coin-conc-c@x');
CALL public.test_complete_profile('80000000-0000-0000-0000-00000000000a', 'ConcA', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('80000000-0000-0000-0000-00000000000b', 'ConcB', '1996-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('dddddddd-0000-0000-0000-0000000000c1', '80000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-00000000000b');

-- Funded caller (100 coins) with accepted video calls already 50s in (10s of free window left).
SELECT public.apply_coin_transaction('80000000-0000-0000-0000-00000000000a', 'grant', 100, 'conc-fund-a-000001');

CREATE TABLE public.coin_conc_calls (label text PRIMARY KEY, id uuid);
GRANT ALL ON public.coin_conc_calls TO PUBLIC;
