-- Enforce completed-profile requirements after the auth-owned profile row is updated.
-- Existing incomplete profiles remain editable and do not need a backfill.
BEGIN;

CREATE OR REPLACE FUNCTION public.validate_profile_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  _photo jsonb;
  _path text;
  _thumb_path text;
BEGIN
  IF NEW.is_demo OR NEW.onboarded IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF char_length(btrim(NEW.name)) < 2 OR NEW.dob IS NULL
     OR NEW.gender NOT IN ('man', 'woman') OR NEW.seeking NOT IN ('man', 'woman')
     OR char_length(btrim(NEW.city)) < 1 OR char_length(btrim(NEW.bio)) < 15
     OR cardinality(NEW.intents) < 1 OR cardinality(NEW.intents) > 6
     OR cardinality(NEW.interests) < 3 OR cardinality(NEW.interests) > 15
     OR cardinality(NEW.languages) > 16
     OR jsonb_typeof(NEW.photos) IS DISTINCT FROM 'array'
     OR CASE
       WHEN jsonb_typeof(NEW.photos) = 'array'
         THEN jsonb_array_length(NEW.photos) < 1 OR jsonb_array_length(NEW.photos) > 6
       ELSE true
     END THEN
    RAISE EXCEPTION 'Profile is incomplete or contains unsupported values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.intents || NEW.interests || NEW.languages) AS value
    WHERE value IS NULL OR char_length(btrim(value)) = 0 OR char_length(value) > 80
  ) THEN
    RAISE EXCEPTION 'Profile lists contain an invalid value';
  END IF;

  FOR _photo IN SELECT value FROM jsonb_array_elements(NEW.photos)
  LOOP
    _path := _photo ->> 'path';
    _thumb_path := _photo ->> 'thumbPath';
    IF jsonb_typeof(_photo) IS DISTINCT FROM 'object'
       OR _path IS NULL OR _path = ''
       OR left(_path, char_length(NEW.id) + 1) <> NEW.id || '/'
       OR _path LIKE '%/verification/%'
       OR _path ~ '(^|/)\.\.?(/|$)'
       OR _thumb_path IS NULL
       OR left(_thumb_path, char_length(NEW.id) + 1) <> NEW.id || '/'
       OR _thumb_path LIKE '%/verification/%'
       OR _thumb_path ~ '(^|/)\.\.?(/|$)'
       OR NOT EXISTS (
         SELECT 1 FROM storage.objects
         WHERE bucket_id = 'photos' AND name = _path AND owner = NEW.id::uuid
       )
       OR NOT EXISTS (
         SELECT 1 FROM storage.objects
         WHERE bucket_id = 'photos' AND name = _thumb_path AND owner = NEW.id::uuid
       ) THEN
      RAISE EXCEPTION 'Profile photo must be an uploaded object owned by this profile';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_profile_completion() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clear_profile_photos_for_deletion(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.profiles
  SET photos = '[]'::jsonb, onboarded = false
  WHERE id = _uid::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_profile_photos_for_deletion(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_profile_photos_for_deletion(uuid) TO service_role;

DROP TRIGGER IF EXISTS profiles_validate_completion ON public.profiles;
CREATE TRIGGER profiles_validate_completion
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_completion();

CREATE OR REPLACE FUNCTION public.prevent_referenced_photo_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  _owner text := (storage.foldername(OLD.name))[1];
BEGIN
  IF OLD.bucket_id <> 'photos' THEN
    RETURN OLD;
  END IF;

  -- Serialize deletion with edits to this owner's profile, then check live references.
  PERFORM 1 FROM public.profiles WHERE id = _owner FOR SHARE;
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.photos) = 'array' THEN p.photos ELSE '[]'::jsonb END
    ) AS photo
    WHERE p.id = _owner
      AND (photo ->> 'path' = OLD.name OR photo ->> 'thumbPath' = OLD.name)
  ) THEN
    RAISE EXCEPTION 'Cannot delete a photo that is still referenced by a profile';
  END IF;

  DELETE FROM public.photo_reviews
  WHERE owner_id = _owner AND path = OLD.name;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_referenced_photo_deletion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS photos_prevent_referenced_deletion ON storage.objects;
CREATE TRIGGER photos_prevent_referenced_deletion
  BEFORE DELETE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.prevent_referenced_photo_deletion();

COMMIT;
