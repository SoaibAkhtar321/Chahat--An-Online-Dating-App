-- Mobile security hardening: DOB lock, server-side quotas, RPC-only swipes, DOB privacy,
-- explicit function/table privileges. Complete account deletion is done by the delete-account
-- Edge Function (Auth user + storage) which calls purge_user_data() below.

-- ---------- 1. profiles_guard: lock DOB once set, enforce 18+, cap array sizes ----------
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
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
  RETURN NEW;
END $$;

-- ---------- 2. Server-side configuration (never client-controlled) ----------
-- UNRESOLVED PRODUCT DECISION: free daily likes (10) and priority likes/day (3) are the values
-- used by the app copy / handoff doc but are "pending client approval". Change them here, not in code.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;  -- no policies: only service_role / definer functions
INSERT INTO public.app_settings (key, value) VALUES
  ('daily_like_limit', '10'::jsonb),
  ('daily_priority_like_limit', '3'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.setting_int(_key text, _default int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (value #>> '{}')::int FROM public.app_settings WHERE key = _key), _default)
$$;

-- ---------- 3. Daily quotas (IST day) ----------
CREATE TABLE IF NOT EXISTS public.user_daily_quotas (
  user_id text NOT NULL,
  ist_date date NOT NULL,
  likes_used integer NOT NULL DEFAULT 0,
  super_likes_used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ist_date)
);
ALTER TABLE public.user_daily_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own daily quotas read" ON public.user_daily_quotas;
CREATE POLICY "own daily quotas read" ON public.user_daily_quotas
  FOR SELECT TO authenticated USING (user_id = auth.uid()::text);

-- ---------- 4. Swipes only through record_swipe ----------
DROP TRIGGER IF EXISTS on_swipe ON public.swipes;
DROP FUNCTION IF EXISTS public.handle_swipe();
DROP POLICY IF EXISTS "insert own swipes" ON public.swipes;
REVOKE INSERT, UPDATE ON public.swipes FROM authenticated;

-- old signature accepted caller-controlled limits
DROP FUNCTION IF EXISTS public.record_swipe(text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.record_swipe(_to_id text, _kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- Serialise swipes between the same pair so two simultaneous likes always produce a match.
  PERFORM pg_advisory_xact_lock(hashtextextended(least(_from_id,_to_id) || '|' || greatest(_from_id,_to_id), 0));

  SELECT * INTO _me FROM public.profiles WHERE id = _from_id;
  IF _me.id IS NULL OR _me.status <> 'active' THEN RAISE EXCEPTION 'Account not active'; END IF;
  SELECT * INTO _them FROM public.profiles WHERE id = _to_id;
  IF _them.id IS NULL OR _them.status <> 'active' OR public.is_blocked_pair(_from_id, _to_id)
     OR (_me.seeking <> '' AND _them.gender <> '' AND _them.gender <> _me.seeking) THEN
    RAISE EXCEPTION 'Profile not available';
  END IF;

  SELECT kind INTO _existing FROM public.swipes WHERE from_id = _from_id AND to_id = _to_id;

  -- Quota applies only when this swipe newly spends a like / priority like.
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

-- ---------- 5. DOB privacy: other users never read dob ----------
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, user_id, is_demo, likes_you, status, name, gender, seeking, city, bio, work, education,
              intents, interests, languages, lifestyle, prompt, photos, onboarded, last_active, created_at)
  ON public.profiles TO authenticated;
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (name, dob, gender, seeking, city, bio, work, education, intents, interests, languages,
              lifestyle, prompt, photos, onboarded, last_active) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_dob()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dob FROM public.profiles WHERE id = auth.uid()::text
$$;

-- Sanitised profile for a visible / matched user, with calculated age only.
CREATE OR REPLACE FUNCTION public.get_public_profile(_id text)
RETURNS TABLE (id text, name text, age integer, city text, bio text, work text, education text,
               interests text[], intents text[], languages text[], lifestyle jsonb, prompt jsonb, photos jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, CASE WHEN p.dob IS NULL THEN 0 ELSE date_part('year', age(p.dob))::integer END,
         p.city, p.bio, p.work, p.education, p.interests, p.intents, p.languages, p.lifestyle, p.prompt, p.photos
  FROM public.profiles p
  WHERE p.id = _id AND auth.uid() IS NOT NULL AND (
    p.id = auth.uid()::text
    OR (p.status = 'active' AND NOT public.is_blocked_pair(p.id, auth.uid()::text))
    OR EXISTS (SELECT 1 FROM public.matches m WHERE auth.uid()::text IN (m.user_a, m.user_b)
               AND p.id IN (m.user_a, m.user_b)))
$$;

-- ---------- 6. Discovery feed (calculated age, no dob) ----------
DROP FUNCTION IF EXISTS public.get_discovery_feed(integer);
CREATE OR REPLACE FUNCTION public.get_discovery_feed(_limit integer DEFAULT 20)
RETURNS TABLE (id text, name text, age integer, city text, bio text, work text, education text,
               interests text[], intents text[], languages text[], lifestyle jsonb, prompt jsonb,
               photos jsonb, is_demo boolean, likes_you boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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

-- ---------- 7. Chat image paths must live in the message's own match folder ----------
DROP POLICY IF EXISTS "members send messages" ON public.messages;
CREATE POLICY "members send messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender = auth.uid()::text AND public.is_match_member(match_id)
    AND (body <> '' OR image_path IS NOT NULL)
    AND (image_path IS NULL OR image_path LIKE match_id::text || '/%')
    AND NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = match_id AND public.is_blocked_pair(m.user_a, m.user_b))
  );

-- ---------- 8. Helpers only answer questions about the caller ----------
CREATE OR REPLACE FUNCTION public.is_blocked_pair(_a text, _b text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.blocks WHERE (blocker = _a AND blocked = _b) OR (blocker = _b AND blocked = _a))
         AND auth.uid() IS NOT NULL AND auth.uid()::text IN (_a, _b)
$$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND _user_id = auth.uid()
         AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ---------- 9. Account deletion data purge (service_role only; called by the Edge Function) ----------
DROP FUNCTION IF EXISTS public.delete_user_account();
CREATE OR REPLACE FUNCTION public.purge_user_data(_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t text := _uid::text;
BEGIN
  DELETE FROM public.matches WHERE user_a = _t OR user_b = _t;   -- messages cascade
  DELETE FROM public.swipes WHERE from_id = _t OR to_id = _t;
  DELETE FROM public.blocks WHERE blocker = _t OR blocked = _t;
  DELETE FROM public.user_daily_quotas WHERE user_id = _t;
  DELETE FROM public.account_state WHERE user_id = _uid;
  DELETE FROM public.profiles WHERE id = _t;
  -- Reports are retained as moderation records (no FK). Audit row proves a self-deletion occurred.
  INSERT INTO public.admin_audit (admin_id, action, target, note)
  VALUES (_uid, 'account_self_deleted', _t, 'User data purged; auth user and media removed by delete-account function');
END $$;

-- ---------- 10. Explicit privileges ----------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON public.app_settings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_daily_quotas FROM authenticated;
GRANT SELECT ON public.user_daily_quotas TO authenticated;
GRANT ALL ON public.app_settings, public.user_daily_quotas TO service_role;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.has_role(uuid, public.app_role), public.is_blocked_pair(text, text), public.is_match_member(uuid),
  public.chat_folder_member(text), public.photo_folder_visible(text), public.demo_reply(uuid),
  public.record_swipe(text, text), public.get_discovery_feed(integer), public.get_my_dob(),
  public.get_public_profile(text)
TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
