-- ===== Migration 0003: Mobile Security Hardening & Quota Enforcement =====
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    NEW.id := OLD.id;
    NEW.user_id := OLD.user_id;
    NEW.is_demo := OLD.is_demo;
    NEW.likes_you := OLD.likes_you;
    NEW.status := OLD.status;
    NEW.created_at := OLD.created_at;

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

  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS public.user_daily_quotas (
  user_id text NOT NULL,
  ist_date date NOT NULL,
  likes_used integer NOT NULL DEFAULT 0,
  super_likes_used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ist_date)
);

ALTER TABLE public.user_daily_quotas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'own daily quotas read') THEN
    CREATE POLICY "own daily quotas read" ON public.user_daily_quotas
      FOR SELECT TO authenticated USING (user_id = auth.uid()::text);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_swipe(
  _to_id text,
  _kind text,
  _free_daily_limit integer DEFAULT 10,
  _super_daily_limit integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from_id text;
  _today_ist date;
  _current_likes int;
  _current_super int;
  _is_match boolean := false;
  _match_id uuid := null;
  _them public.profiles;
BEGIN
  _from_id := auth.uid()::text;
  IF _from_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _from_id = _to_id THEN
    RAISE EXCEPTION 'Cannot swipe on own profile';
  END IF;

  IF _kind NOT IN ('like', 'pass', 'priority') THEN
    RAISE EXCEPTION 'Invalid swipe kind';
  END IF;

  IF public.is_blocked_pair(_from_id, _to_id) THEN
    RAISE EXCEPTION 'Profile unavailable';
  END IF;

  SELECT * INTO _them FROM public.profiles WHERE id = _to_id;
  IF _them.id IS NULL OR _them.status <> 'active' THEN
    RAISE EXCEPTION 'Profile is not active or does not exist';
  END IF;

  _today_ist := (timezone('Asia/Kolkata', now()))::date;

  IF _kind IN ('like', 'priority') THEN
    INSERT INTO public.user_daily_quotas (user_id, ist_date, likes_used, super_likes_used)
    VALUES (_from_id, _today_ist, 0, 0)
    ON CONFLICT (user_id, ist_date) DO NOTHING;

    SELECT likes_used, super_likes_used INTO _current_likes, _current_super
    FROM public.user_daily_quotas
    WHERE user_id = _from_id AND ist_date = _today_ist
    FOR UPDATE;

    IF _kind = 'like' AND _current_likes >= _free_daily_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'daily_like_limit_reached',
        'likes_remaining', 0,
        'reset_at_ist', _today_ist + 1
      );
    END IF;

    IF _kind = 'priority' AND _current_super >= _super_daily_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'daily_super_like_limit_reached',
        'super_likes_remaining', 0
      );
    END IF;

    UPDATE public.user_daily_quotas
    SET likes_used = likes_used + 1,
        super_likes_used = CASE WHEN _kind = 'priority' THEN super_likes_used + 1 ELSE super_likes_used END,
        updated_at = now()
    WHERE user_id = _from_id AND ist_date = _today_ist;
  END IF;

  INSERT INTO public.swipes (from_id, to_id, kind, created_at)
  VALUES (_from_id, _to_id, _kind, now())
  ON CONFLICT (from_id, to_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = now();

  IF _kind = 'pass' THEN
    RETURN jsonb_build_object('success', true, 'is_match', false);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.swipes
    WHERE from_id = _to_id AND to_id = _from_id AND kind IN ('like', 'priority')
  ) OR (_them.is_demo AND _them.likes_you) THEN
    INSERT INTO public.matches (user_a, user_b)
    VALUES (least(_from_id, _to_id), greatest(_from_id, _to_id))
    ON CONFLICT (user_a, user_b) DO NOTHING
    RETURNING id INTO _match_id;

    IF _match_id IS NULL THEN
      SELECT id INTO _match_id FROM public.matches
      WHERE user_a = least(_from_id, _to_id) AND user_b = greatest(_from_id, _to_id);
    END IF;

    _is_match := true;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'is_match', _is_match,
    'match_id', _match_id,
    'likes_remaining', GREATEST(0, _free_daily_limit - (_current_likes + 1))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_swipe(text, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_discovery_feed(
  _limit integer DEFAULT 20
)
RETURNS TABLE (
  id text,
  name text,
  age integer,
  city text,
  bio text,
  work text,
  education text,
  interests text[],
  intents text[],
  languages text[],
  lifestyle jsonb,
  prompt jsonb,
  photos jsonb,
  is_demo boolean,
  likes_you boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _my_id text;
  _my_seeking text;
  _my_city text;
BEGIN
  _my_id := auth.uid()::text;
  IF _my_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT seeking, city INTO _my_seeking, _my_city FROM public.profiles WHERE id = _my_id;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    CASE WHEN p.dob IS NOT NULL THEN (date_part('year', age(p.dob)))::integer ELSE 0 END AS age,
    p.city,
    p.bio,
    p.work,
    p.education,
    p.interests,
    p.intents,
    p.languages,
    p.lifestyle,
    p.prompt,
    p.photos,
    p.is_demo,
    p.likes_you
  FROM public.profiles p
  WHERE p.id <> _my_id
    AND p.status = 'active'
    AND p.onboarded = true
    AND NOT public.is_blocked_pair(_my_id, p.id)
    AND (_my_seeking = '' OR p.gender = '' OR p.gender = _my_seeking)
    AND (_my_city = '' OR p.city = '' OR LOWER(p.city) = LOWER(_my_city))
    AND NOT EXISTS (SELECT 1 FROM public.swipes s WHERE s.from_id = _my_id AND s.to_id = p.id)
  ORDER BY p.last_active DESC
  LIMIT _limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_discovery_feed(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid text;
BEGIN
  _uid := auth.uid()::text;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM public.matches WHERE user_a = _uid OR user_b = _uid;
  DELETE FROM public.swipes WHERE from_id = _uid OR to_id = _uid;
  DELETE FROM public.blocks WHERE blocker = _uid OR blocked = _uid;
  DELETE FROM public.account_state WHERE user_id = auth.uid();
  DELETE FROM public.profiles WHERE id = _uid;

  INSERT INTO public.admin_audit (admin_id, action, target, note)
  VALUES (auth.uid(), 'account_self_deleted', _uid, 'User initiated complete account deletion');
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;
