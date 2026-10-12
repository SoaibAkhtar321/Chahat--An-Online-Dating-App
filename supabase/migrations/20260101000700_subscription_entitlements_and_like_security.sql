-- 20260101000700_subscription_entitlements_and_like_security.sql
-- T6: Server-side Entitlements, Like Security, Received-Likes Privacy, Undo-Pass Gating, and Read Receipts Authorization.

-- ---------- 1. Server-side Subscriptions Storage ----------
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  user_id text PRIMARY KEY,
  tier text NOT NULL CHECK (tier IN ('free', 'premium', 'plus', 'vip')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  auto_renew boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_subscriptions_tier_idx ON public.user_subscriptions (tier, status);
CREATE INDEX IF NOT EXISTS user_subscriptions_expiry_idx ON public.user_subscriptions (user_id, status, expires_at);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own subscription read" ON public.user_subscriptions;
CREATE POLICY "own subscription read" ON public.user_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

-- Direct client modification is strictly revoked; only server-side service_role / webhooks can modify.
REVOKE ALL ON public.user_subscriptions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.user_subscriptions FROM authenticated;
GRANT SELECT ON public.user_subscriptions TO authenticated;
GRANT ALL ON public.user_subscriptions TO service_role;

-- Helper to safely compute active tier (expired/cancelled rows return 'free')
CREATE OR REPLACE FUNCTION public.get_active_subscription_tier(_user_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _tier text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN 'free';
  END IF;

  SELECT tier INTO _tier
  FROM public.user_subscriptions
  WHERE user_id = _user_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY
    CASE tier
      WHEN 'vip' THEN 3
      WHEN 'plus' THEN 2
      WHEN 'premium' THEN 1
      ELSE 0
    END DESC
  LIMIT 1;

  RETURN coalesce(_tier, 'free');
END $$;

REVOKE EXECUTE ON FUNCTION public.get_active_subscription_tier(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_subscription_tier(text) TO authenticated, service_role;

-- ---------- 2. Hardened record_swipe with server-side tier entitlements ----------
CREATE OR REPLACE FUNCTION public.record_swipe(_to_id text, _kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _from_id text := auth.uid()::text;
  _today date := (timezone('Asia/Kolkata', now()))::date;
  _like_limit int := public.setting_int('daily_like_limit', 10);
  _prio_limit int := public.setting_int('daily_priority_like_limit', 3);
  _tier text;
  _is_paid_tier boolean;
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

  _tier := public.get_active_subscription_tier(_from_id);
  _is_paid_tier := _tier IN ('premium', 'plus', 'vip');

  SELECT kind INTO _existing FROM public.swipes WHERE from_id = _from_id AND to_id = _to_id;

  -- Quota applies only when this swipe newly spends a like / priority like.
  IF _kind IN ('like','priority') AND _existing IS DISTINCT FROM _kind THEN
    INSERT INTO public.user_daily_quotas (user_id, ist_date) VALUES (_from_id, _today)
      ON CONFLICT (user_id, ist_date) DO NOTHING;
    SELECT likes_used, super_likes_used INTO _likes, _prio FROM public.user_daily_quotas
      WHERE user_id = _from_id AND ist_date = _today FOR UPDATE;

    -- Free users strictly limited to 10 daily likes (T6 requirement)
    IF _kind = 'like' AND NOT _is_paid_tier AND _likes >= _like_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'daily_like_limit_reached',
        'likes_remaining', 0, 'reset_at_ist', _today + 1);
    END IF;

    IF _kind = 'priority' AND _prio >= _prio_limit THEN
      RETURN jsonb_build_object('success', false, 'error', 'daily_super_like_limit_reached',
        'super_likes_remaining', 0,
        'likes_remaining', (CASE WHEN _is_paid_tier THEN 999 ELSE greatest(0, _like_limit - _likes) END),
        'reset_at_ist', _today + 1);
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
    'likes_remaining', (CASE WHEN _is_paid_tier THEN 999 ELSE greatest(0, _like_limit - _likes) END),
    'super_likes_remaining', greatest(0, _prio_limit - _prio));
END $$;

-- ---------- 3. Protect Received Likes at RLS boundary ----------
-- Drop unrestricted policy from 0000_core_schema.sql
DROP POLICY IF EXISTS "read own swipes and likes received" ON public.swipes;

-- Policy 1: Users can always read their own outgoing swipes
CREATE POLICY "read own outgoing swipes" ON public.swipes
  FOR SELECT TO authenticated
  USING (from_id = auth.uid()::text);

-- Policy 2: ONLY active paid tiers (premium, plus, vip) can read incoming likes
CREATE POLICY "paid members read received likes" ON public.swipes
  FOR SELECT TO authenticated
  USING (
    to_id = auth.uid()::text
    AND kind <> 'pass'
    AND public.get_active_subscription_tier(auth.uid()::text) IN ('premium', 'plus', 'vip')
  );

-- Helper RPC: All users can get the count of incoming likes without exposing user identities
CREATE OR REPLACE FUNCTION public.get_incoming_likes_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::integer FROM public.swipes
  WHERE to_id = auth.uid()::text AND kind <> 'pass'
    AND NOT EXISTS (SELECT 1 FROM public.swipes s WHERE s.from_id = auth.uid()::text AND s.to_id = swipes.from_id)
    AND NOT public.is_blocked_pair(auth.uid()::text, from_id);
$$;

REVOKE EXECUTE ON FUNCTION public.get_incoming_likes_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_incoming_likes_count() TO authenticated, service_role;

-- ---------- 4. Secure Undo-Pass Functionality ----------
-- Remove unrestricted client deletion
DROP POLICY IF EXISTS "undo own pass" ON public.swipes;
REVOKE DELETE ON public.swipes FROM authenticated;

-- Narrowly scoped RPC requiring active paid tier
CREATE OR REPLACE FUNCTION public.undo_swipe_pass(_target_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _my_id text := auth.uid()::text;
  _tier text;
  _deleted boolean := false;
BEGIN
  IF _my_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _target_id IS NULL THEN RAISE EXCEPTION 'Target required'; END IF;

  _tier := public.get_active_subscription_tier(_my_id);
  IF _tier NOT IN ('premium', 'plus', 'vip') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'upgrade_required',
      'message', 'Rewind is only available on CHAHAT Premium, Plus, and VIP'
    );
  END IF;

  DELETE FROM public.swipes
  WHERE from_id = _my_id AND to_id = _target_id AND kind = 'pass';
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  RETURN jsonb_build_object('success', _deleted > 0, 'undone', _deleted > 0);
END $$;

REVOKE EXECUTE ON FUNCTION public.undo_swipe_pass(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_swipe_pass(text) TO authenticated, service_role;

-- ---------- 5. Server-side Read Receipts Authorization (Plus & VIP only) ----------
CREATE OR REPLACE FUNCTION public.get_match_messages(_match_id uuid)
RETURNS TABLE (
  id uuid,
  match_id uuid,
  sender text,
  body text,
  image_path text,
  created_at timestamptz,
  read_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _my_id text := auth.uid()::text;
  _tier text;
BEGIN
  IF _my_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.is_match_member(_match_id) THEN RAISE EXCEPTION 'Not a member of this match'; END IF;

  _tier := public.get_active_subscription_tier(_my_id);

  RETURN QUERY
  SELECT
    m.id,
    m.match_id,
    m.sender,
    m.body,
    m.image_path,
    m.created_at,
    -- If caller is the message sender: read_at is returned ONLY for Plus and VIP members.
    -- If caller is the recipient: read_at is returned normally.
    CASE
      WHEN m.sender = _my_id AND _tier NOT IN ('plus', 'vip') THEN NULL
      ELSE m.read_at
    END AS read_at
  FROM public.messages m
  WHERE m.match_id = _match_id
  ORDER BY m.created_at ASC;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_match_messages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_match_messages(uuid) TO authenticated, service_role;

-- ---------- 6. Update Account Deletion Purge to Include Subscriptions ----------
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
  DELETE FROM public.profiles WHERE id = _t;
  INSERT INTO public.admin_audit (admin_id, action, target, note)
  VALUES (_uid, 'account_self_deleted', _t, 'User data purged; auth user and media removed by delete-account function');
END $$;
