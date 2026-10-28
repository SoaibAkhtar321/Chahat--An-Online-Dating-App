-- Fixtures for 75_allowance_concurrency.sh (concurrency database only).
CREATE OR REPLACE PROCEDURE public.test_complete_profile(
  _uid uuid, _name text, _dob date, _gender text, _seeking text,
  _photo_name text DEFAULT 'test-profile.jpg'
) LANGUAGE plpgsql AS $$
DECLARE _path text := _uid::text || '/' || _photo_name;
BEGIN
  INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('photos', _path, _uid) ON CONFLICT DO NOTHING;
  UPDATE public.profiles
  SET name = _name, dob = _dob, gender = _gender, seeking = _seeking,
      city = 'Pune', bio = 'A complete test profile for database regressions.',
      intents = ARRAY['Friendship'], interests = ARRAY['Books', 'Coffee', 'Music'],
      photos = jsonb_build_array(jsonb_build_object('id', 'test-profile', 'path', _path, 'thumbPath', _path)),
      onboarded = true
  WHERE id = _uid::text;
END $$;

INSERT INTO public.app_settings (key, value) VALUES
  ('call_daily_allowance_enabled', '1'::jsonb), ('call_free_daily_seconds', '30'::jsonb),
  ('call_connect_grace_seconds', '30'::jsonb), ('call_join_slack_seconds', '0'::jsonb),
  ('call_create_limit_per_10min', '1000'::jsonb), ('call_create_limit_per_match_10min', '1000'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO auth.users(id, email) VALUES
  ('75000000-0000-0000-0000-00000000000a', 'c75a@x'), ('75000000-0000-0000-0000-00000000000b', 'c75b@x'),
  ('75000000-0000-0000-0000-00000000000c', 'c75c@x'), ('75000000-0000-0000-0000-00000000000d', 'c75d@x'),
  ('75000000-0000-0000-0000-00000000000e', 'c75e@x'), ('75000000-0000-0000-0000-00000000000f', 'c75f@x');
CALL public.test_complete_profile('75000000-0000-0000-0000-00000000000a', 'C75A', '1995-01-01', 'man', 'woman', 'c.jpg');
CALL public.test_complete_profile('75000000-0000-0000-0000-00000000000b', 'C75B', '1996-01-01', 'woman', 'man', 'c.jpg');
CALL public.test_complete_profile('75000000-0000-0000-0000-00000000000c', 'C75C', '1996-01-01', 'woman', 'man', 'c.jpg');
CALL public.test_complete_profile('75000000-0000-0000-0000-00000000000d', 'C75D', '1996-01-01', 'woman', 'man', 'c.jpg');
CALL public.test_complete_profile('75000000-0000-0000-0000-00000000000e', 'C75E', '1995-01-01', 'man', 'woman', 'c.jpg');
CALL public.test_complete_profile('75000000-0000-0000-0000-00000000000f', 'C75F', '1996-01-01', 'woman', 'man', 'c.jpg');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('75aaaaaa-0000-0000-0000-0000000000b1', '75000000-0000-0000-0000-00000000000a', '75000000-0000-0000-0000-00000000000b'),
  ('75aaaaaa-0000-0000-0000-0000000000c1', '75000000-0000-0000-0000-00000000000a', '75000000-0000-0000-0000-00000000000c'),
  ('75aaaaaa-0000-0000-0000-0000000000d1', '75000000-0000-0000-0000-00000000000a', '75000000-0000-0000-0000-00000000000d');
-- Premium rewinder E has passed F.
INSERT INTO public.user_subscriptions(user_id, tier, status, starts_at, expires_at)
VALUES ('75000000-0000-0000-0000-00000000000e', 'premium', 'active', now() - interval '1 day', now() + interval '6 days');
INSERT INTO public.swipes(from_id, to_id, kind) VALUES ('75000000-0000-0000-0000-00000000000e', '75000000-0000-0000-0000-00000000000f', 'pass');
