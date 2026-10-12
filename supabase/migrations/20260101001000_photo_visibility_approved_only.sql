-- 20260101001000_photo_visibility_approved_only.sql
-- Task 1D: replace the 1A owner-only stopgap with APPROVED-ONLY visibility.
-- A photo is visible to anyone but its owner only when ALL hold:
--   * its photo_reviews row is 'approved' and bound to the CURRENT storage.objects.id for that path
--     (so replacing the file invalidates the approval),
--   * it is not under the owner's verification/ folder (selfies are never public),
--   * the owner is an active, onboarded profile and the pair is not blocked.
-- Client-supplied `status` inside photos JSONB is never trusted or returned.

-- 0. Verification selfies can never have review rows (so they can never be approved) --------
DELETE FROM public.photo_reviews WHERE split_part(path, '/', 2) = 'verification';
ALTER TABLE public.photo_reviews
  ADD CONSTRAINT photo_reviews_not_verification CHECK (split_part(path, '/', 2) <> 'verification');

CREATE OR REPLACE FUNCTION public.sync_photo_reviews(_owner text, _photos jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _paths text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT s.p), ARRAY[]::text[]) INTO _paths
  FROM (
    SELECT e ->> k AS p
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_photos) = 'array' THEN _photos ELSE '[]'::jsonb END) AS e,
         unnest(ARRAY['path', 'thumbPath']) AS k
  ) s
  WHERE s.p IS NOT NULL AND s.p <> '' AND left(s.p, length(_owner) + 1) = _owner || '/'
    AND split_part(s.p, '/', 2) <> 'verification';

  DELETE FROM public.photo_reviews WHERE owner_id = _owner AND NOT (path = ANY (_paths));
  INSERT INTO public.photo_reviews (owner_id, path)
    SELECT _owner, unnest(_paths) ON CONFLICT (owner_id, path) DO NOTHING;
END $$;

-- 1. Is this exact path approved for the object that exists right now? --------------------
CREATE OR REPLACE FUNCTION public.photo_is_public(_owner text, _path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    _owner IS NOT NULL AND _path IS NOT NULL AND _path <> ''
    AND left(_path, length(_owner) + 1) = _owner || '/'
    AND split_part(_path, '/', 2) <> 'verification'
    AND EXISTS (
      SELECT 1
      FROM public.photo_reviews r
      JOIN storage.objects o ON o.bucket_id = 'photos' AND o.name = r.path
      WHERE r.owner_id = _owner AND r.path = _path
        AND r.status = 'approved' AND r.object_id IS NOT NULL AND r.object_id = o.id),
    false)
$$;

-- 2. Photos as other people may see them: approved only, whitelisted fields, no status. ------
CREATE OR REPLACE FUNCTION public.public_photos(_owner text, _photos jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'id', t.e ->> 'id',
             'path', t.e ->> 'path',
             'thumbPath', CASE WHEN public.photo_is_public(_owner, t.e ->> 'thumbPath') THEN t.e ->> 'thumbPath' END))
           ORDER BY t.ord), '[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_photos) = 'array' THEN _photos ELSE '[]'::jsonb END)
         WITH ORDINALITY AS t(e, ord)
  WHERE public.photo_is_public(_owner, t.e ->> 'path')
$$;

-- 3. Photos as their owner sees them: all of them, with the SERVER-derived review status. -----
CREATE OR REPLACE FUNCTION public.owner_photos(_owner text, _photos jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'id', t.e ->> 'id',
             'path', t.e ->> 'path',
             'thumbPath', t.e ->> 'thumbPath',
             'status', CASE
                         WHEN r.status = 'approved' AND NOT public.photo_is_public(_owner, t.e ->> 'path') THEN 'pending'
                         ELSE coalesce(r.status, 'pending') END,
             'rejectionReason', r.rejection_reason))
           ORDER BY t.ord), '[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_photos) = 'array' THEN _photos ELSE '[]'::jsonb END)
         WITH ORDINALITY AS t(e, ord)
  LEFT JOIN public.photo_reviews r ON r.owner_id = _owner AND r.path = t.e ->> 'path'
$$;

-- 4. Storage read policy: owner folder, or an approved + bound object of a visible profile. ---
CREATE OR REPLACE FUNCTION public.photo_object_readable(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
    (storage.foldername(_name))[1] = auth.uid()::text
    OR (
      public.photo_is_public((storage.foldername(_name))[1], _name)
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (storage.foldername(_name))[1] AND p.status = 'active' AND p.onboarded
          AND NOT public.is_blocked_pair(p.id, auth.uid()::text))))
$$;

DROP POLICY IF EXISTS "photos read visible" ON storage.objects;
CREATE POLICY "photos read visible" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND public.photo_object_readable(name));

-- No UPDATE policy: stored photo objects can never be overwritten in place. Replacement means a new
-- path (client uploads with upsert:false); a deleted-and-reuploaded path gets a new object id and
-- therefore loses any approval.
DROP POLICY IF EXISTS "photos update own folder" ON storage.objects;

-- 5. RPCs -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_profile(_id text)
RETURNS TABLE (id text, name text, age integer, city text, bio text, work text, education text,
               interests text[], intents text[], languages text[], lifestyle jsonb, prompt jsonb, photos jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.name, CASE WHEN p.dob IS NULL THEN 0 ELSE date_part('year', age(p.dob))::integer END,
         p.city, p.bio, p.work, p.education, p.interests, p.intents, p.languages, p.lifestyle, p.prompt,
         CASE
           WHEN p.id = auth.uid()::text THEN public.owner_photos(p.id, p.photos)
           WHEN p.status = 'active' AND p.onboarded AND NOT public.is_blocked_pair(p.id, auth.uid()::text)
             THEN public.public_photos(p.id, p.photos)
           ELSE '[]'::jsonb END
  FROM public.profiles p
  WHERE p.id = _id AND auth.uid() IS NOT NULL AND (
    p.id = auth.uid()::text
    OR (p.status = 'active' AND NOT public.is_blocked_pair(p.id, auth.uid()::text))
    OR EXISTS (SELECT 1 FROM public.matches m WHERE auth.uid()::text IN (m.user_a, m.user_b)
               AND p.id IN (m.user_a, m.user_b)))
$$;

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
         public.public_photos(p.id, p.photos)
  FROM public.profiles p
  WHERE p.id <> _my_id AND p.status = 'active' AND p.onboarded
    AND NOT public.is_blocked_pair(_my_id, p.id)
    AND (_seeking = '' OR p.gender = '' OR p.gender = _seeking)
    AND (_city = '' OR p.city = '' OR lower(p.city) = lower(_city))
    AND NOT EXISTS (SELECT 1 FROM public.swipes s WHERE s.from_id = _my_id AND s.to_id = p.id)
  ORDER BY p.last_active DESC
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
END $$;

CREATE OR REPLACE FUNCTION public.get_my_photos()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT public.owner_photos(p.id, p.photos) FROM public.profiles p WHERE p.id = auth.uid()::text),
    '[]'::jsonb)
$$;

-- 6. Grants: internal helpers are not client-callable; the storage policy helper must be. ------
REVOKE EXECUTE ON FUNCTION public.photo_is_public(text, text), public.public_photos(text, jsonb),
  public.owner_photos(text, jsonb), public.photo_object_readable(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_is_public(text, text), public.public_photos(text, jsonb),
  public.owner_photos(text, jsonb), public.photo_object_readable(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.photo_object_readable(text) TO authenticated;
