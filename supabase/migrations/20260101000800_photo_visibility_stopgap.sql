-- 20260101000800_photo_visibility_stopgap.sql
-- EMERGENCY STOPGAP (task 1A): until per-photo moderation exists (1B/1D), user photos are visible
-- ONLY to their owner. Nothing here approves, deletes or modifies any existing photo data.
-- Closes four read paths: (1) storage SELECT, (2) get_public_profile, (3) get_discovery_feed,
-- (4) direct SELECT of profiles.photos via table RLS + column grant.

-- 1. Storage: a photos folder is readable only by its owner. (Signature kept: policy depends on it.)
CREATE OR REPLACE FUNCTION public.photo_folder_visible(_folder text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND _folder = auth.uid()::text
$$;

-- 2. get_public_profile: photos returned only to the owner; everyone else gets an empty array.
CREATE OR REPLACE FUNCTION public.get_public_profile(_id text)
RETURNS TABLE (id text, name text, age integer, city text, bio text, work text, education text,
               interests text[], intents text[], languages text[], lifestyle jsonb, prompt jsonb, photos jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.name, CASE WHEN p.dob IS NULL THEN 0 ELSE date_part('year', age(p.dob))::integer END,
         p.city, p.bio, p.work, p.education, p.interests, p.intents, p.languages, p.lifestyle, p.prompt,
         CASE WHEN p.id = auth.uid()::text THEN p.photos ELSE '[]'::jsonb END
  FROM public.profiles p
  WHERE p.id = _id AND auth.uid() IS NOT NULL AND (
    p.id = auth.uid()::text
    OR (p.status = 'active' AND NOT public.is_blocked_pair(p.id, auth.uid()::text))
    OR EXISTS (SELECT 1 FROM public.matches m WHERE auth.uid()::text IN (m.user_a, m.user_b)
               AND p.id IN (m.user_a, m.user_b)))
$$;

-- 3. get_discovery_feed: never returns photos (the feed excludes the caller's own profile).
CREATE OR REPLACE FUNCTION public.get_discovery_feed(_limit integer DEFAULT 20)
RETURNS TABLE (id text, name text, age integer, city text, bio text, work text, education text,
               interests text[], intents text[], languages text[], lifestyle jsonb, prompt jsonb,
               photos jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _my_id text := auth.uid()::text; _seeking text; _city text;
BEGIN
  IF _my_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT pr.seeking, pr.city INTO _seeking, _city FROM public.profiles pr WHERE pr.id = _my_id;
  RETURN QUERY
  SELECT p.id, p.name, CASE WHEN p.dob IS NULL THEN 0 ELSE date_part('year', age(p.dob))::integer END,
         p.city, p.bio, p.work, p.education, p.interests, p.intents, p.languages, p.lifestyle, p.prompt,
         '[]'::jsonb
  FROM public.profiles p
  WHERE p.id <> _my_id AND p.status = 'active' AND p.onboarded
    AND NOT public.is_blocked_pair(_my_id, p.id)
    AND (_seeking = '' OR p.gender = '' OR p.gender = _seeking)
    AND (_city = '' OR p.city = '' OR lower(p.city) = lower(_city))
    AND NOT EXISTS (SELECT 1 FROM public.swipes s WHERE s.from_id = _my_id AND s.to_id = p.id)
  ORDER BY p.last_active DESC
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
END $$;

-- 4. Direct table reads: remove `photos` from the authenticated column grant (same list as
--    20260101000500, minus photos). Owners read their own photos through get_my_photos().
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, user_id, status, name, gender, seeking, city, bio, work, education,
              intents, interests, languages, lifestyle, prompt, onboarded, last_active, created_at)
  ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_photos()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT p.photos FROM public.profiles p WHERE p.id = auth.uid()::text), '[]'::jsonb)
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_photos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_photos() TO authenticated, service_role;

-- CREATE OR REPLACE keeps existing grants on the two RPCs; re-assert them explicitly anyway.
REVOKE EXECUTE ON FUNCTION public.get_public_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_discovery_feed(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discovery_feed(integer) TO authenticated, service_role;
