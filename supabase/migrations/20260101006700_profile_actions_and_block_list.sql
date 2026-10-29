-- 20260101006700_profile_actions_and_block_list.sql
-- Forward-only. Two new read-only RPCs; no table, policy or existing function is changed.
--
-- 1. get_profile_actions(_id): what the signed-in member may do on a profile they are viewing (opened from a
--    shared link, from chat or from Discover). Decides on the server, from both members' real profiles:
--      * already matched     -> the app shows "Message" instead of Like / Pass
--      * already liked        -> no second like (a profile passed earlier may still be liked)
--      * gender preferences do not fit (either side) -> no Like button, a clear explanation instead.
--        record_swipe already refuses a like outside the viewer's own preference; this also covers the other
--        side (a like they could never see or return is pointless).
--    Returns no personal data beyond what the viewer can already see; blocked or unavailable profiles return
--    only available = false.
--
-- 2. get_my_blocked_users(): the signed-in member's own block list (name and when they were blocked) for the
--    "Blocked accounts" screen, where they can unblock. Blocking still removes the match and conversation and
--    keeps both people invisible to each other everywhere (unchanged RLS); this only lists one's own blocks.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_profile_actions(_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
  _me public.profiles;
  _them public.profiles;
  _match uuid;
  _my_swipe text;
  _mine_ok boolean;
  _theirs_ok boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Profile required'; END IF;
  IF _id = _uid THEN
    RETURN jsonb_build_object('available', true, 'self', true);
  END IF;

  SELECT * INTO _me FROM public.profiles WHERE id = _uid;
  SELECT * INTO _them FROM public.profiles WHERE id = _id;
  IF _them.id IS NULL OR _them.status <> 'active' OR NOT _them.onboarded OR _them.is_demo
     OR public.is_blocked_pair(_uid, _id) THEN
    RETURN jsonb_build_object('available', false);
  END IF;

  SELECT m.id INTO _match FROM public.matches m
  WHERE m.user_a = least(_uid, _id) AND m.user_b = greatest(_uid, _id);

  SELECT s.kind INTO _my_swipe FROM public.swipes s WHERE s.from_id = _uid AND s.to_id = _id;

  _mine_ok := coalesce(_me.seeking, '') = '' OR _them.gender = '' OR _them.gender = _me.seeking;
  _theirs_ok := coalesce(_them.seeking, '') = '' OR coalesce(_me.gender, '') = '' OR _me.gender = _them.seeking;

  RETURN jsonb_build_object(
    'available', true,
    'self', false,
    'match_id', _match,
    'my_swipe', _my_swipe,
    'can_like', _match IS NULL AND coalesce(_my_swipe, 'pass') = 'pass' AND _mine_ok AND _theirs_ok
                AND _me.status = 'active' AND _me.onboarded,
    'reason', CASE
      WHEN _match IS NOT NULL THEN 'matched'
      WHEN _my_swipe IN ('like', 'priority') THEN 'already_liked'
      -- One combined reason: never reveal which side's preference does not fit.
      WHEN NOT (_mine_ok AND _theirs_ok) THEN 'preferences_dont_match'
      ELSE NULL END,
    'your_preference', nullif(_me.seeking, '')
  );
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_profile_actions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_actions(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_blocked_users()
RETURNS TABLE (id text, name text, blocked_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.blocked, coalesce(nullif(p.name, ''), 'Member'), b.created_at
  FROM public.blocks b
  LEFT JOIN public.profiles p ON p.id = b.blocked
  WHERE auth.uid() IS NOT NULL AND b.blocker = auth.uid()::text
  ORDER BY b.created_at DESC
  LIMIT 500;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_blocked_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_blocked_users() TO authenticated;

COMMIT;
