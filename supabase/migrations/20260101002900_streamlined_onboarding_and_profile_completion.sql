-- 20260101002900_streamlined_onboarding_and_profile_completion.sql
-- Streamline profile completion: essential fields required for onboarding, optional fields permitted in later completion.

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

  IF jsonb_typeof(NEW.photos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Profile is incomplete or contains unsupported values';
  END IF;

  -- Genuinely required fields for safe account creation and discovery:
  -- Name (min 2 chars), Date of Birth, Gender & Seeking, City, and at least 1 verified photo.
  IF char_length(btrim(NEW.name)) < 2 OR NEW.dob IS NULL
     OR NEW.gender NOT IN ('man', 'woman') OR NEW.seeking NOT IN ('man', 'woman')
     OR char_length(btrim(NEW.city)) < 1
     OR jsonb_array_length(NEW.photos) < 1
     OR jsonb_array_length(NEW.photos) > 6 THEN
    RAISE EXCEPTION 'Profile is incomplete or contains unsupported values';
  END IF;

  -- Optional fields length checks if provided
  IF char_length(NEW.bio) > 500 OR char_length(NEW.work) > 80 OR char_length(NEW.education) > 80 THEN
    RAISE EXCEPTION 'Profile field exceeds maximum allowed length';
  END IF;

  IF cardinality(NEW.intents) > 6 OR cardinality(NEW.interests) > 15 OR cardinality(NEW.languages) > 16 THEN
    RAISE EXCEPTION 'Profile lists contain too many entries';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.intents || NEW.interests || NEW.languages) AS value
    WHERE value IS NULL OR char_length(btrim(value)) = 0 OR char_length(value) > 80
  ) THEN
    RAISE EXCEPTION 'Profile lists contain an invalid value';
  END IF;

  -- Validate photo ownership and safety
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

COMMIT;
