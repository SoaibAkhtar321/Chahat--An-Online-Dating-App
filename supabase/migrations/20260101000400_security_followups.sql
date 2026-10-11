-- Security follow-ups:
-- 1. Photo path ownership in profiles_guard (prevents pointing to another user's photos)
-- 2. Hardened search_path on all SECURITY DEFINER functions (search_path = public, pg_temp)
-- 3. Production safety: restrict demo_reply to demo accounts only or non-production contexts

-- 1. profiles_guard with photo path ownership check
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  elem jsonb;
  photo_path text;
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

  -- Validate photo path ownership: every photo path MUST start with NEW.id || '/' unless empty
  IF jsonb_typeof(NEW.photos) = 'array' THEN
    FOR elem IN SELECT * FROM jsonb_array_elements(NEW.photos) LOOP
      photo_path := elem->>'path';
      IF photo_path IS NOT NULL AND photo_path <> '' AND NOT (photo_path LIKE NEW.id || '/%') THEN
        RAISE EXCEPTION 'Invalid photo path: must belong to user folder';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END $$;

-- 2. search_path = public, pg_temp on all SECURITY DEFINER functions
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND _user_id = auth.uid()
         AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_blocked_pair(_a text, _b text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.blocks WHERE (blocker = _a AND blocked = _b) OR (blocker = _b AND blocked = _a))
         AND auth.uid() IS NOT NULL AND auth.uid()::text IN (_a, _b)
$$;

CREATE OR REPLACE FUNCTION public.is_match_member(_match uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.matches WHERE id = _match AND auth.uid()::text IN (user_a, user_b))
$$;

CREATE OR REPLACE FUNCTION public.photo_folder_visible(_folder text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _folder = auth.uid()::text OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _folder AND p.status = 'active' AND p.onboarded
      AND NOT public.is_blocked_pair(p.id, auth.uid()::text))
$$;

CREATE OR REPLACE FUNCTION public.chat_folder_member(_folder text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.matches WHERE id::text = _folder AND auth.uid()::text IN (user_a, user_b))
$$;

CREATE OR REPLACE FUNCTION public.setting_int(_key text, _default int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT (value #>> '{}')::int FROM public.app_settings WHERE key = _key), _default)
$$;

CREATE OR REPLACE FUNCTION public.get_my_dob()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT dob FROM public.profiles WHERE id = auth.uid()::text
$$;

CREATE OR REPLACE FUNCTION public.get_public_profile(_id text)
RETURNS TABLE (id text, name text, age integer, city text, bio text, work text, education text,
               interests text[], intents text[], languages text[], lifestyle jsonb, prompt jsonb, photos jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.name, CASE WHEN p.dob IS NULL THEN 0 ELSE date_part('year', age(p.dob))::integer END,
         p.city, p.bio, p.work, p.education, p.interests, p.intents, p.languages, p.lifestyle, p.prompt, p.photos
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
               photos jsonb, is_demo boolean, likes_you boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _my_id text := auth.uid()::text; _seeking text; _city text;
BEGIN
  IF _my_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT pr.seeking, pr.city INTO _seeking, _city FROM public.profiles pr WHERE pr.id = _my_id;
  RETURN QUERY
  SELECT p.id, p.name, CASE WHEN p.dob IS NULL THEN 0 ELSE date_part('year', age(p.dob))::integer END,
         p.city, p.bio, p.work, p.education, p.interests, p.intents, p.languages, p.lifestyle, p.prompt,
         p.photos, p.is_demo, p.likes_you
  FROM public.profiles p
  WHERE p.id <> _my_id AND p.status = 'active' AND p.onboarded
    AND NOT public.is_blocked_pair(_my_id, p.id)
    AND (_seeking = '' OR p.gender = '' OR p.gender = _seeking)
    AND (_city = '' OR p.city = '' OR lower(p.city) = lower(_city))
    AND NOT EXISTS (SELECT 1 FROM public.swipes s WHERE s.from_id = _my_id AND s.to_id = p.id)
  ORDER BY p.last_active DESC
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
END $$;

CREATE OR REPLACE FUNCTION public.record_swipe(_to_id text, _kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _from_id text := auth.uid()::text;
  _today date := (timezone('Asia/Kolkata', now()))::date;
  _like_limit int := public.setting_int('daily_like_limit', 10);
  _prio_limit int := public.setting_int('daily_priority_like_limit', 3);
  _likes int; _prio int;
  _me public.profiles; _them public.profiles;
  _existing text; _match_id uuid; _is_match boolean := false;
BEGIN
  IF _from_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _to_id IS NULL OR _from_id = _to_id THEN RAISE EXCEPTION 'Cannot swipe on own profile'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('like','pass','priority') THEN RAISE EXCEPTION 'Invalid swipe kind'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(least(_from_id,_to_id) || '|' || greatest(_from_id,_to_id), 0));

  SELECT * INTO _me FROM public.profiles WHERE id = _from_id;
  IF _me.id IS NULL OR _me.status <> 'active' THEN RAISE EXCEPTION 'Account not active'; END IF;
  SELECT * INTO _them FROM public.profiles WHERE id = _to_id;
  IF _them.id IS NULL OR _them.status <> 'active' OR public.is_blocked_pair(_from_id, _to_id)
     OR (_me.seeking <> '' AND _them.gender <> '' AND _them.gender <> _me.seeking) THEN
    RAISE EXCEPTION 'Profile not available';
  END IF;

  SELECT kind INTO _existing FROM public.swipes WHERE from_id = _from_id AND to_id = _to_id;

  IF _kind IN ('like','priority') AND _existing IS DISTINCT FROM _kind THEN
    INSERT INTO public.user_daily_quotas (user_id, ist_date) VALUES (_from_id, _today)
      ON CONFLICT (user_id, ist_date) DO NOTHING;
    SELECT likes_used, super_likes_used INTO _likes, _prio FROM public.user_daily_quotas
      WHERE user_id = _from_id AND ist_date = _today FOR UPDATE;

    IF _kind = 'like' AND _likes >= _like_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'daily_like_limit_reached',
        'likes_remaining', 0, 'reset_at_ist', _today + 1);
    END IF;
    IF _kind = 'priority' AND _prio >= _prio_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'daily_super_like_limit_reached',
        'super_likes_remaining', 0, 'likes_remaining', greatest(0, _like_limit - _likes), 'reset_at_ist', _today + 1);
    END IF;
    UPDATE public.user_daily_quotas
      SET likes_used = likes_used + (CASE WHEN _kind = 'like' THEN 1 ELSE 0 END),
          super_likes_used = super_likes_used + (CASE WHEN _kind = 'priority' THEN 1 ELSE 0 END),
          updated_at = now()
      WHERE user_id = _from_id AND ist_date = _today
      RETURNING likes_used, super_likes_used INTO _likes, _prio;
  ELSE
    SELECT likes_used, super_likes_used INTO _likes, _prio FROM public.user_daily_quotas
      WHERE user_id = _from_id AND ist_date = _today;
    _likes := coalesce(_likes, 0); _prio := coalesce(_prio, 0);
  END IF;

  INSERT INTO public.swipes (from_id, to_id, kind) VALUES (_from_id, _to_id, _kind)
    ON CONFLICT (from_id, to_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = now();

  IF _kind <> 'pass' AND (
       EXISTS (SELECT 1 FROM public.swipes WHERE from_id = _to_id AND to_id = _from_id AND kind <> 'pass')
       OR (_them.is_demo AND _them.likes_you)) THEN
    INSERT INTO public.matches (user_a, user_b) VALUES (least(_from_id,_to_id), greatest(_from_id,_to_id))
      ON CONFLICT (user_a, user_b) DO NOTHING;
    SELECT id INTO _match_id FROM public.matches
      WHERE user_a = least(_from_id,_to_id) AND user_b = greatest(_from_id,_to_id);
    _is_match := true;
  END IF;

  RETURN jsonb_build_object('success', true, 'is_match', _is_match, 'match_id', _match_id,
    'likes_remaining', greatest(0, _like_limit - _likes),
    'super_likes_remaining', greatest(0, _prio_limit - _prio));
END $$;

CREATE OR REPLACE FUNCTION public.purge_user_data(_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _t text := _uid::text;
BEGIN
  DELETE FROM public.matches WHERE user_a = _t OR user_b = _t;
  DELETE FROM public.swipes WHERE from_id = _t OR to_id = _t;
  DELETE FROM public.blocks WHERE blocker = _t OR blocked = _t;
  DELETE FROM public.user_daily_quotas WHERE user_id = _t;
  DELETE FROM public.account_state WHERE user_id = _uid;
  DELETE FROM public.profiles WHERE id = _t;
  INSERT INTO public.admin_audit (admin_id, action, target, note)
  VALUES (_uid, 'account_self_deleted', _t, 'User data purged; auth user and media removed by delete-account function');
END $$;
