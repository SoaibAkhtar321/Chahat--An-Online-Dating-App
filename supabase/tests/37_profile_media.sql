\set ON_ERROR_STOP on
-- Profile completion, authenticated ownership, and referenced photo deletion regressions.

INSERT INTO public.t_results
SELECT 'bundled demo profiles remain compatible with photo-free seed data',
  count(*) = 6,
  count(*)::text
FROM public.profiles
WHERE is_demo AND onboarded;

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'profile-media-1@x'),
  ('00000000-0000-0000-0000-0000000000e2', 'profile-media-2@x');

SET ROLE service_role;
INSERT INTO storage.objects(bucket_id, name, owner) VALUES
  ('photos', '00000000-0000-0000-0000-0000000000e1/photo-one.jpg',
   '00000000-0000-0000-0000-0000000000e1'),
  ('photos', '00000000-0000-0000-0000-0000000000e1/photo-two.jpg',
   '00000000-0000-0000-0000-0000000000e1'),
  ('photos', '00000000-0000-0000-0000-0000000000e2/photo-wrong-owner.jpg',
   '00000000-0000-0000-0000-0000000000e1');
UPDATE public.profiles
SET name = 'Profile One',
    dob = '1995-01-01',
    gender = 'woman',
    seeking = 'man',
    city = 'Pune',
    bio = 'I like thoughtful conversations and weekend walks.',
    intents = ARRAY['Friendship'],
    interests = ARRAY['Books', 'Coffee', 'Music'],
    photos = '[{"id":"one","path":"00000000-0000-0000-0000-0000000000e1/photo-one.jpg","thumbPath":"00000000-0000-0000-0000-0000000000e1/photo-one.jpg"}]'::jsonb,
    onboarded = true
WHERE id = '00000000-0000-0000-0000-0000000000e1';
RESET ROLE;

CALL public.expect_fail(
  'incomplete onboarding cannot be marked complete',
  $q$UPDATE public.profiles SET onboarded = true WHERE id = '00000000-0000-0000-0000-0000000000e2'$q$
);
CALL public.expect_fail(
  'profile completion rejects another account photo path',
  $q$UPDATE public.profiles
     SET name = 'Profile Two', dob = '1995-01-01', gender = 'man', seeking = 'woman',
         city = 'Pune', bio = 'A long enough profile bio for completion.',
         intents = ARRAY['Friendship'], interests = ARRAY['Books', 'Coffee', 'Music'],
         photos = '[{"id":"foreign","path":"00000000-0000-0000-0000-0000000000e1/photo-one.jpg","thumbPath":"00000000-0000-0000-0000-0000000000e1/photo-one.jpg"}]'::jsonb,
         onboarded = true
     WHERE id = '00000000-0000-0000-0000-0000000000e2'$q$
);
CALL public.expect_fail(
  'verification selfies cannot be referenced as profile photos',
  $q$UPDATE public.profiles
     SET photos = '[{"id":"selfie","path":"00000000-0000-0000-0000-0000000000e1/verification/selfie.jpg","thumbPath":"00000000-0000-0000-0000-0000000000e1/verification/selfie.jpg"}]'::jsonb
     WHERE id = '00000000-0000-0000-0000-0000000000e1'$q$
);
CALL public.expect_fail(
  'profile completion rejects a photo object owned by another account',
  $q$UPDATE public.profiles
     SET name = 'Profile Two', dob = '1995-01-01', gender = 'man', seeking = 'woman',
         city = 'Pune', bio = 'A long enough profile bio for completion.',
         intents = ARRAY['Friendship'], interests = ARRAY['Books', 'Coffee', 'Music'],
         photos = '[{"id":"wrong-owner","path":"00000000-0000-0000-0000-0000000000e2/photo-wrong-owner.jpg","thumbPath":"00000000-0000-0000-0000-0000000000e2/photo-wrong-owner.jpg"}]'::jsonb,
         onboarded = true
     WHERE id = '00000000-0000-0000-0000-0000000000e2'$q$
);

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e2';
DO $$
DECLARE _rows integer;
BEGIN
  UPDATE public.profiles SET name = 'Unauthorized'
  WHERE id = '00000000-0000-0000-0000-0000000000e1';
  GET DIAGNOSTICS _rows = ROW_COUNT;
  INSERT INTO public.t_results VALUES(
    'cross-account profile update changed no rows', _rows = 0, _rows::text
  );
END $$;
INSERT INTO public.t_results
SELECT 'foreign photo object is hidden by storage RLS', count(*) = 0, count(*)::text
FROM storage.objects
WHERE bucket_id = 'photos' AND name = '00000000-0000-0000-0000-0000000000e1/photo-one.jpg';
RESET ROLE;

SET ROLE service_role;
UPDATE public.profiles
SET photos = '[{"id":"two","path":"00000000-0000-0000-0000-0000000000e1/photo-two.jpg","thumbPath":"00000000-0000-0000-0000-0000000000e1/photo-two.jpg"}]'::jsonb
WHERE id = '00000000-0000-0000-0000-0000000000e1';
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
CALL public.expect_ok(
  'unreferenced replaced photo can be deleted',
  $q$DELETE FROM storage.objects
     WHERE bucket_id = 'photos'
       AND name = '00000000-0000-0000-0000-0000000000e1/photo-one.jpg'$q$
);
CALL public.expect_fail(
  'referenced profile photo cannot be deleted',
  $q$DELETE FROM storage.objects
     WHERE bucket_id = 'photos'
       AND name = '00000000-0000-0000-0000-0000000000e1/photo-two.jpg'$q$
);
CALL public.expect_fail(
  'authenticated users cannot clear profile photo references for deletion',
  $q$SELECT public.clear_profile_photos_for_deletion(
       '00000000-0000-0000-0000-0000000000e1'::uuid
     )$q$
);
RESET ROLE;

SET ROLE service_role;
CALL public.clear_profile_photos_for_deletion('00000000-0000-0000-0000-0000000000e1'::uuid);
INSERT INTO public.t_results
SELECT 'account deletion clears profile media references first',
  NOT onboarded AND photos = '[]'::jsonb,
  jsonb_build_object('onboarded', onboarded, 'photos', photos)::text
FROM public.profiles
WHERE id = '00000000-0000-0000-0000-0000000000e1';
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
CALL public.expect_ok(
  'photo can be deleted after account media references are cleared',
  $q$DELETE FROM storage.objects
     WHERE bucket_id = 'photos'
       AND name = '00000000-0000-0000-0000-0000000000e1/photo-two.jpg'$q$
);
RESET ROLE;
