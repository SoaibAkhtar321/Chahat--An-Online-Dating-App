-- 20260101001300_critical_security_foundations.sql
-- Phase B: Critical Security Foundations
-- 1. Block Isolation: Update is_match_member, chat_folder_member, and get_public_profile to strictly enforce NOT is_blocked_pair.
-- 2. Transactional Block Cleanup Trigger: Automatic server-side cascade of matches and swipes upon block insertion.
-- 3. Match Read RLS Policy Hardening: Matches table read policy enforces NOT is_blocked_pair.
-- 4. Verification Guard: Prevent client self-approval of verification status in account_state.
-- 5. Hardened purge_user_data: Ensure explicit photo_reviews cleanup before profiles deletion.

-- -----------------------------------------------------------------------------
-- 1. Hardened is_match_member: blocked pairs cannot access match membership
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_match_member(_match uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id = _match
      AND auth.uid() IS NOT NULL
      AND auth.uid()::text IN (m.user_a, m.user_b)
      AND NOT public.is_blocked_pair(m.user_a, m.user_b)
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_match_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_match_member(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Hardened chat_folder_member: blocked pairs cannot read/upload chat media
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_folder_member(_folder text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id::text = _folder
      AND auth.uid() IS NOT NULL
      AND auth.uid()::text IN (m.user_a, m.user_b)
      AND NOT public.is_blocked_pair(m.user_a, m.user_b)
  )
$$;

REVOKE EXECUTE ON FUNCTION public.chat_folder_member(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_folder_member(text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Hardened matches SELECT policy: hide matches between blocked pairs
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "members read match" ON public.matches;
CREATE POLICY "members read match" ON public.matches FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND auth.uid()::text IN (user_a, user_b)
    AND NOT public.is_blocked_pair(user_a, user_b)
  );

-- -----------------------------------------------------------------------------
-- 4. Automatic transactional cleanup when a block is inserted
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.on_block_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- 1. Remove any match between blocker and blocked (cascades to messages)
  DELETE FROM public.matches
  WHERE user_a = least(NEW.blocker, NEW.blocked)
    AND user_b = greatest(NEW.blocker, NEW.blocked);

  -- 2. Clean up any existing swipes between the pair so no stale like/pass state remains
  DELETE FROM public.swipes
  WHERE (from_id = NEW.blocker AND to_id = NEW.blocked)
     OR (from_id = NEW.blocked AND to_id = NEW.blocker);

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.on_block_cleanup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_block_cleanup ON public.blocks;
CREATE TRIGGER on_block_cleanup
  AFTER INSERT ON public.blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.on_block_cleanup();

-- -----------------------------------------------------------------------------
-- 5. Hardened get_public_profile: blocked users can never inspect the profile
-- -----------------------------------------------------------------------------
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
    OR (
      p.status = 'active'
      AND NOT public.is_blocked_pair(p.id, auth.uid()::text)
      AND (
        p.onboarded
        OR EXISTS (
          SELECT 1 FROM public.matches m
          WHERE auth.uid()::text IN (m.user_a, m.user_b)
            AND p.id IN (m.user_a, m.user_b)
            AND NOT public.is_blocked_pair(m.user_a, m.user_b)
        )
      )
    )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile(text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Hardened account_state: prevent client from self-approving verification
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_state_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    IF (NEW.data -> 'verification' ->> 'status') = 'approved'
       AND (OLD.data IS NULL OR (OLD.data -> 'verification' ->> 'status') IS DISTINCT FROM 'approved') THEN
      RAISE EXCEPTION 'Verification status cannot be self-approved by client.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.account_state_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS account_state_guard ON public.account_state;
CREATE TRIGGER account_state_guard
  BEFORE INSERT OR UPDATE ON public.account_state
  FOR EACH ROW
  EXECUTE FUNCTION public.account_state_guard();

-- -----------------------------------------------------------------------------
-- 7. Hardened purge_user_data: explicit photo_reviews cleanup before profiles delete
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_user_data(_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _t text := _uid::text;
BEGIN
  DELETE FROM public.matches WHERE user_a = _t OR user_b = _t;
  DELETE FROM public.swipes WHERE from_id = _t OR to_id = _t;
  DELETE FROM public.blocks WHERE blocker = _t OR blocked = _t;
  DELETE FROM public.user_daily_quotas WHERE user_id = _t;
  DELETE FROM public.user_subscriptions WHERE user_id = _t;
  DELETE FROM public.account_state WHERE user_id = _uid;
  DELETE FROM public.photo_reviews WHERE owner_id = _t;
  DELETE FROM public.profiles WHERE id = _t;
  INSERT INTO public.admin_audit (admin_id, action, target, note)
  VALUES (_uid, 'account_self_deleted', _t, 'User data purged; auth user and media removed by delete-account function');
END $$;

REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;
