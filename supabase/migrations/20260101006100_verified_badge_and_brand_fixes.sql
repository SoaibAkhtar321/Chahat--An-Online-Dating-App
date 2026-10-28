-- 20260101006100_verified_badge_and_brand_fixes.sql
-- Launch gap fixes (forward-only, no signature of an existing function changes):
--
-- 1. Selfie verification was only half built: members could submit a selfie (status "pending" in
--    account_state.data.verification), but (a) there was no audited server path to approve/reject it, and
--    (b) no client-callable path exposed the resulting badge, so the "Verified" badge the Safety Centre tells users
--    to look for could never appear on anyone else's card or profile.
--      * review_verification(user, status, reviewer, note)  service_role only (admin tool / dashboard), audited.
--      * get_verified_profile_ids(ids)                      returns which of the given, visible profiles are
--        approved. Only a boolean badge leaves the server; the selfie itself and review notes never do.
-- 2. Two database errors that reach users still said "Milo" (the app's former name). Same checks, Chahat wording.
BEGIN;

-- ---------- 1a. Admin review (service_role only) ----------
CREATE OR REPLACE FUNCTION public.review_verification(_user_id uuid, _status text, _reviewer uuid, _note text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _state public.account_state;
BEGIN
  IF _status NOT IN ('approved', 'rejected', 'none') THEN RAISE EXCEPTION 'Invalid verification status'; END IF;
  IF _user_id IS NULL OR _reviewer IS NULL THEN RAISE EXCEPTION 'User and reviewer required'; END IF;
  SELECT * INTO _state FROM public.account_state WHERE user_id = _user_id FOR UPDATE;
  IF _state.user_id IS NULL THEN RAISE EXCEPTION 'No account state for this user'; END IF;
  IF _status = 'approved' AND coalesce(_state.data #>> '{verification,status}', 'none') <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending verification can be approved';
  END IF;

  -- account_state_guard lets service_role through; mark this transaction as such for the guard.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.account_state
     SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{verification}',
                  jsonb_build_object('status', _status, 'reviewed_at', now()), true),
         updated_at = now()
   WHERE user_id = _user_id;

  INSERT INTO public.admin_audit (admin_id, action, target, note)
  VALUES (_reviewer, 'verification_' || _status, _user_id::text, left(coalesce(_note, ''), 500));
  RETURN jsonb_build_object('ok', true, 'status', _status);
END
$$;
REVOKE EXECUTE ON FUNCTION public.review_verification(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_verification(uuid, text, uuid, text) TO service_role;

-- ---------- 1b. Badge lookup for the app ----------
CREATE OR REPLACE FUNCTION public.get_verified_profile_ids(_ids text[])
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN RETURN; END IF;
  IF cardinality(_ids) > 100 THEN RAISE EXCEPTION 'Too many profiles'; END IF;

  RETURN QUERY
  SELECT p.id
  FROM public.profiles p
  JOIN public.account_state s ON s.user_id::text = p.id
  WHERE p.id = ANY (_ids)
    AND (p.id = _uid OR (p.status = 'active' AND p.onboarded AND NOT p.is_demo
                         AND NOT public.is_blocked_pair(p.id, _uid)))
    AND s.data #>> '{verification,status}' = 'approved';
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_verified_profile_ids(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_verified_profile_ids(text[]) TO authenticated;

-- ---------- 2. User-facing wording (logic identical to 20260101000400) ----------
CREATE OR REPLACE FUNCTION public.profiles_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, pg_temp
AS $function$
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
      RAISE EXCEPTION 'Date of birth cannot be changed once saved. Contact Chahat support for assistance.';
    END IF;
  END IF;

  IF NEW.dob IS NOT NULL AND NEW.dob > (current_date - interval '18 years')::date THEN
    RAISE EXCEPTION 'You must be 18 or older to use Chahat';
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
END $function$;

COMMIT;
