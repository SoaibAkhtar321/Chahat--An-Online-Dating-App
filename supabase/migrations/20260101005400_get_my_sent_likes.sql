-- 20260101005400_get_my_sent_likes.sql
-- Premium members can see the profiles THEY liked ("You liked" list in the Likes tab).
-- Mirrors get_received_likes (20260101003800): the function is the only path to this data for the app, the
-- entitlement is decided on the server from user_subscriptions (never a client flag), and the caller can only ever
-- read their own outgoing likes (auth.uid() is the only identity used; there is no user id parameter).
-- Forward-only and idempotent (CREATE OR REPLACE); no table, policy or existing function is changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_sent_likes(
  _limit integer DEFAULT 50,
  _before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id text, name text, age integer, city text, photos jsonb, kind text, liked_at timestamptz, is_match boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  -- Free members (or an expired / refunded subscription) get nothing, not even a count.
  IF public.get_active_subscription_tier(_uid) NOT IN ('premium', 'plus', 'vip') THEN
    RAISE EXCEPTION 'upgrade_required' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit < 1 OR _limit > 100 THEN
    RAISE EXCEPTION 'Invalid limit';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name,
         CASE WHEN p.dob IS NULL THEN NULL ELSE date_part('year', age(p.dob))::integer END,
         p.city,
         public.public_photos(p.id, p.photos),
         s.kind, s.created_at,
         EXISTS (
           SELECT 1 FROM public.matches m
           WHERE m.user_a = least(s.from_id, s.to_id) AND m.user_b = greatest(s.from_id, s.to_id)
         )
  FROM public.swipes s
  JOIN public.profiles p ON p.id = s.to_id
  WHERE s.from_id = _uid
    AND s.kind IN ('like', 'priority')
    -- never list people who are blocked (either direction), deactivated, not onboarded, or demo accounts
    AND NOT public._pair_blocked(_uid, s.to_id)
    AND p.is_demo = false AND p.status = 'active' AND p.onboarded
    AND (_before IS NULL OR s.created_at < _before)
  ORDER BY s.created_at DESC, p.id
  LIMIT _limit;
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_sent_likes(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sent_likes(integer, timestamptz) TO authenticated;

COMMIT;
