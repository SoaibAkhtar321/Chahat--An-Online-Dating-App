-- Fixtures for 49_call_expiry_concurrency.sh (concurrency database only).
CREATE OR REPLACE PROCEDURE public.test_complete_profile(
  _uid uuid, _name text, _dob date, _gender text, _seeking text,
  _photo_name text DEFAULT 'test-profile.jpg'
) LANGUAGE plpgsql AS $$
DECLARE _path text := _uid::text || '/' || _photo_name;
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

INSERT INTO auth.users(id, email) VALUES
  ('92000000-0000-0000-0000-00000000000a', 'exp-conc-a@x'),
  ('92000000-0000-0000-0000-00000000000b', 'exp-conc-b@x');
CALL public.test_complete_profile('92000000-0000-0000-0000-00000000000a', 'ExpA', '1995-01-01', 'man', 'woman', 'exp.jpg');
CALL public.test_complete_profile('92000000-0000-0000-0000-00000000000b', 'ExpB', '1996-01-01', 'woman', 'man', 'exp.jpg');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('dddddddd-0000-0000-0000-0000000000f1', '92000000-0000-0000-0000-00000000000a', '92000000-0000-0000-0000-00000000000b');
