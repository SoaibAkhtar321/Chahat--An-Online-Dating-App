-- 20260101000900_photo_reviews.sql
-- Task 1B: per-photo review records. ADDITIVE ONLY: this migration does not change who can see photos
-- (that is 1A now, and 1D later). It records, per owner + storage path, whether a photo is
-- pending / approved / rejected, and binds an approval to one specific storage object.
-- The photos JSONB `status` supplied by clients is never read here.

-- 1. Table ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.photo_reviews (
  owner_id         text        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  path             text        NOT NULL,
  status           text        NOT NULL DEFAULT 'pending',
  rejection_reason text,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  object_id        uuid,        -- storage.objects.id this decision applies to
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, path),
  CONSTRAINT photo_reviews_status_valid CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT photo_reviews_path_in_owner_folder CHECK (left(path, length(owner_id) + 1) = owner_id || '/'),
  CONSTRAINT photo_reviews_approved_needs_object CHECK (
    status <> 'approved' OR (object_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT photo_reviews_rejected_needs_review CHECK (status <> 'rejected' OR reviewed_at IS NOT NULL),
  CONSTRAINT photo_reviews_pending_is_clean CHECK (
    status <> 'pending' OR (reviewed_at IS NULL AND object_id IS NULL AND rejection_reason IS NULL))
);

-- 2. RLS / grants: owners may read their own rows (not reviewer or object id); nobody writes from clients.
ALTER TABLE public.photo_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT (owner_id, path, status, rejection_reason, reviewed_at, created_at, updated_at)
  ON public.photo_reviews TO authenticated;
GRANT ALL ON public.photo_reviews TO service_role;
DROP POLICY IF EXISTS "owner reads own photo reviews" ON public.photo_reviews;
CREATE POLICY "owner reads own photo reviews" ON public.photo_reviews FOR SELECT TO authenticated
  USING (owner_id = auth.uid()::text);

-- 3. Sync: one row per distinct path / thumbPath inside the owner's own folder --------------
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
  WHERE s.p IS NOT NULL AND s.p <> '' AND left(s.p, length(_owner) + 1) = _owner || '/';

  DELETE FROM public.photo_reviews WHERE owner_id = _owner AND NOT (path = ANY (_paths));
  INSERT INTO public.photo_reviews (owner_id, path)
    SELECT _owner, unnest(_paths) ON CONFLICT (owner_id, path) DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION public.sync_photo_reviews(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_photo_reviews(text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.profiles_sync_photo_reviews()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.sync_photo_reviews(NEW.id, NEW.photos);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.profiles_sync_photo_reviews() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_sync_photo_reviews ON public.profiles;
CREATE TRIGGER profiles_sync_photo_reviews
  AFTER INSERT OR UPDATE OF photos ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_sync_photo_reviews();

-- 4. Server-only review mutation. Approval is bound to the CURRENT storage object id. -------
CREATE OR REPLACE FUNCTION public.review_photo(_owner text, _path text, _status text, _reason text, _reviewer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _oid uuid;
BEGIN
  IF _status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid photo review status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.photo_reviews WHERE owner_id = _owner AND path = _path) THEN
    RAISE EXCEPTION 'No review record for this photo';
  END IF;
  SELECT o.id INTO _oid FROM storage.objects o WHERE o.bucket_id = 'photos' AND o.name = _path;
  IF _status = 'approved' AND _oid IS NULL THEN
    RAISE EXCEPTION 'Cannot approve a photo that has no stored object';
  END IF;
  UPDATE public.photo_reviews SET
    status = _status,
    rejection_reason = CASE WHEN _status = 'rejected' THEN nullif(left(_reason, 500), '') END,
    reviewed_by = CASE WHEN _status = 'pending' THEN NULL ELSE _reviewer END,
    reviewed_at = CASE WHEN _status = 'pending' THEN NULL ELSE now() END,
    object_id = CASE WHEN _status = 'pending' THEN NULL ELSE _oid END,
    updated_at = now()
  WHERE owner_id = _owner AND path = _path;
END $$;
REVOKE EXECUTE ON FUNCTION public.review_photo(text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_photo(text, text, text, text, uuid) TO service_role;

-- 5. profiles_guard: also require thumbPath to live in the owner's folder (previously unchecked).
--    Body is the 20260101000400 definition plus the thumbPath check.
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  elem jsonb;
  photo_path text;
  thumb_path text;
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    NEW.id := OLD.id; NEW.user_id := OLD.user_id; NEW.is_demo := OLD.is_demo;
    NEW.likes_you := OLD.likes_you; NEW.status := OLD.status; NEW.created_at := OLD.created_at;
    IF OLD.dob IS NOT NULL AND NEW.dob IS DISTINCT FROM OLD.dob THEN
      RAISE EXCEPTION 'Date of birth cannot be changed once saved. Contact Milo Support for assistance.';
    END IF;
  END IF;

  IF NEW.dob IS NOT NULL AND NEW.dob > (current_date - interval '18 years')::date THEN
    RAISE EXCEPTION 'You must be 18 or older to use Milo';
  END IF;

  IF array_length(NEW.interests, 1) > 15 OR array_length(NEW.intents, 1) > 6 OR array_length(NEW.languages, 1) > 16
     OR jsonb_array_length(NEW.photos) > 6 THEN
    RAISE EXCEPTION 'Exceeded allowed number of profile items';
  END IF;

  -- Validate photo path ownership: every photo path and thumbPath MUST start with NEW.id || '/' unless empty
  IF jsonb_typeof(NEW.photos) = 'array' THEN
    FOR elem IN SELECT * FROM jsonb_array_elements(NEW.photos) LOOP
      photo_path := elem->>'path';
      IF photo_path IS NOT NULL AND photo_path <> '' AND NOT (photo_path LIKE NEW.id || '/%') THEN
        RAISE EXCEPTION 'Invalid photo path: must belong to user folder';
      END IF;
      thumb_path := elem->>'thumbPath';
      IF thumb_path IS NOT NULL AND thumb_path <> ''
         AND left(thumb_path, length(NEW.id) + 1) <> NEW.id || '/' THEN
        RAISE EXCEPTION 'Invalid photo thumbnail path: must belong to user folder';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END $$;

-- 6. Backfill: every existing photo path / thumbPath starts as PENDING (nothing is auto-approved).
SELECT public.sync_photo_reviews(p.id, p.photos) FROM public.profiles p;
