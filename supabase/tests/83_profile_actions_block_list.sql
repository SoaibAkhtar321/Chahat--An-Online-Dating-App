\set ON_ERROR_STOP on
-- 20260101006700: get_profile_actions (what a viewer may do on a shared/opened profile) and get_my_blocked_users.
INSERT INTO auth.users(id, email) VALUES
  ('83000000-0000-0000-0000-00000000000a', 'pa-man1@x'),    -- man seeking woman (viewer)
  ('83000000-0000-0000-0000-00000000000b', 'pa-woman@x'),   -- woman seeking man
  ('83000000-0000-0000-0000-00000000000c', 'pa-man2@x'),    -- man seeking woman (same as viewer)
  ('83000000-0000-0000-0000-00000000000d', 'pa-woman2@x'),  -- woman seeking woman
  ('83000000-0000-0000-0000-00000000000e', 'pa-woman3@x');  -- woman seeking man, will be matched then blocked
CALL public.test_complete_profile('83000000-0000-0000-0000-00000000000a', 'PA1', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('83000000-0000-0000-0000-00000000000b', 'PA2', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('83000000-0000-0000-0000-00000000000c', 'PA3', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('83000000-0000-0000-0000-00000000000d', 'PA4', '1996-01-01', 'woman', 'woman');
CALL public.test_complete_profile('83000000-0000-0000-0000-00000000000e', 'PA5', '1996-01-01', 'woman', 'man');

CREATE FUNCTION public.t83_actions(_viewer uuid, _target text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', _viewer::text, true);
  _r := public.get_profile_actions(_target);
  PERFORM set_config('role', 'postgres', true);
  RETURN _r;
END $$;

SET ROLE anon;
CALL public.expect_fail('profile actions: anon cannot call', $q$SELECT public.get_profile_actions('83000000-0000-0000-0000-00000000000b')$q$);
CALL public.expect_fail('blocked list: anon cannot call', $q$SELECT * FROM public.get_my_blocked_users()$q$);
RESET ROLE;

INSERT INTO public.t_results SELECT 'profile actions: opposite gender, preferences fit -> can like',
  (r->>'can_like')::boolean AND r->>'reason' IS NULL AND r->>'your_preference' = 'woman', r::text
FROM (SELECT public.t83_actions('83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-00000000000b') r) x;
INSERT INTO public.t_results SELECT 'profile actions: boy opens a boy''s shared profile -> no like, clear reason',
  NOT (r->>'can_like')::boolean AND r->>'reason' = 'preferences_dont_match' AND (r->>'available')::boolean, r::text
FROM (SELECT public.t83_actions('83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-00000000000c') r) x;
INSERT INTO public.t_results SELECT 'profile actions: their preference does not fit -> no like, same generic reason',
  NOT (r->>'can_like')::boolean AND r->>'reason' = 'preferences_dont_match', r::text
FROM (SELECT public.t83_actions('83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-00000000000d') r) x;
INSERT INTO public.t_results SELECT 'profile actions: own profile -> self, no actions',
  (r->>'self')::boolean, r::text
FROM (SELECT public.t83_actions('83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-00000000000a') r) x;

-- A like from the profile screen is recorded for THAT profile; afterwards no second like.
SET ROLE authenticated; SET request.jwt.claim.sub = '83000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_json SELECT 'pa_like', public.record_swipe('83000000-0000-0000-0000-00000000000b', 'like');
RESET ROLE;
INSERT INTO public.t_results SELECT 'profile actions: after liking -> already_liked, no second like',
  NOT (r->>'can_like')::boolean AND r->>'reason' = 'already_liked', r::text
FROM (SELECT public.t83_actions('83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-00000000000b') r) x;
-- Same-gender like is still refused by record_swipe itself.
SET ROLE authenticated; SET request.jwt.claim.sub = '83000000-0000-0000-0000-00000000000a';
CALL public.expect_fail('record_swipe: a like outside the viewer''s preference is refused',
  $q$SELECT public.record_swipe('83000000-0000-0000-0000-00000000000c', 'like')$q$);
RESET ROLE;

-- Matched -> the screen offers Message.
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('83aaaaaa-0000-0000-0000-0000000000a1', '83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-00000000000e');
INSERT INTO public.t_results SELECT 'profile actions: matched -> match_id, no like',
  r->>'match_id' = '83aaaaaa-0000-0000-0000-0000000000a1' AND r->>'reason' = 'matched' AND NOT (r->>'can_like')::boolean, r::text
FROM (SELECT public.t83_actions('83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-00000000000e') r) x;

-- Block -> unavailable for both, listed only in the blocker's own list.
SET ROLE authenticated; SET request.jwt.claim.sub = '83000000-0000-0000-0000-00000000000a';
INSERT INTO public.blocks(blocker, blocked) VALUES ('83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-00000000000e');
INSERT INTO public.t_json SELECT 'pa_blocked', coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) FROM public.get_my_blocked_users() b;
SET request.jwt.claim.sub = '83000000-0000-0000-0000-00000000000e';
INSERT INTO public.t_json SELECT 'pa_blocked_other', coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) FROM public.get_my_blocked_users() b;
RESET ROLE;
INSERT INTO public.t_results SELECT 'blocked list: blocker sees name and date',
  jsonb_array_length(result) = 1 AND result->0->>'id' = '83000000-0000-0000-0000-00000000000e'
    AND result->0->>'name' = 'PA5' AND result->0->>'blocked_at' IS NOT NULL, result::text
FROM public.t_json WHERE label = 'pa_blocked';
INSERT INTO public.t_results SELECT 'blocked list: the blocked person sees nothing (not even that they were blocked)',
  jsonb_array_length(result) = 0, result::text FROM public.t_json WHERE label = 'pa_blocked_other';
INSERT INTO public.t_results SELECT 'profile actions: blocked pair -> unavailable both ways, nothing else returned',
  r1 = '{"available": false}'::jsonb AND r2 = '{"available": false}'::jsonb, r1::text || r2::text
FROM (SELECT public.t83_actions('83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-00000000000e') r1,
             public.t83_actions('83000000-0000-0000-0000-00000000000e', '83000000-0000-0000-0000-00000000000a') r2) x;
INSERT INTO public.t_results SELECT 'block: the match and its chat are removed (unchanged safety rule)',
  NOT EXISTS (SELECT 1 FROM public.matches WHERE id = '83aaaaaa-0000-0000-0000-0000000000a1'), 'match gone';

-- Unblock -> available again and likeable.
SET ROLE authenticated; SET request.jwt.claim.sub = '83000000-0000-0000-0000-00000000000a';
DELETE FROM public.blocks WHERE blocker = '83000000-0000-0000-0000-00000000000a' AND blocked = '83000000-0000-0000-0000-00000000000e';
RESET ROLE;
INSERT INTO public.t_results SELECT 'unblock: profile is available and can be liked again',
  (r->>'available')::boolean AND (r->>'can_like')::boolean, r::text
FROM (SELECT public.t83_actions('83000000-0000-0000-0000-00000000000a', '83000000-0000-0000-0000-00000000000e') r) x;
