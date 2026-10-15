-- 20260101001500_subscription_orders_and_replay_protection.sql
-- Phase D: Store Purchase Verification, Order Tracking, and Token Replay Protection.

-- 1. Subscription Orders Table ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store text NOT NULL CHECK (store IN ('google_play', 'stripe', 'manual_grant')),
  order_id text,
  product_id text NOT NULL,
  token_hash text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('premium', 'plus', 'vip')),
  amount_inr numeric(10,2) NOT NULL DEFAULT 0.00,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_orders_token_unique UNIQUE (store, token_hash)
);

CREATE INDEX IF NOT EXISTS subscription_orders_user_idx ON public.subscription_orders (user_id);
CREATE INDEX IF NOT EXISTS subscription_orders_token_idx ON public.subscription_orders (store, token_hash);

-- 2. Row Level Security & Grants ----------------------------------------------
ALTER TABLE public.subscription_orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.subscription_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.subscription_orders TO authenticated;
GRANT ALL ON public.subscription_orders TO service_role;

DROP POLICY IF EXISTS "own subscription orders read" ON public.subscription_orders;
CREATE POLICY "own subscription orders read" ON public.subscription_orders
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 3. Service-role-only RPC: record_verified_purchase -------------------------
-- Atomically records a verified store purchase and updates user_subscriptions.
-- If the token_hash was already redeemed, it raises an exception (replay protection).
CREATE OR REPLACE FUNCTION public.record_verified_purchase(
  _user_id text,
  _store text,
  _order_id text,
  _product_id text,
  _tier text,
  _token_hash text,
  _amount_inr numeric,
  _duration_months integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid;
  _starts_at timestamptz := now();
  _expires_at timestamptz;
  _order_uuid uuid;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'User ID required'; END IF;
  _uid := _user_id::uuid;

  IF _store IS NULL OR _store NOT IN ('google_play', 'stripe', 'manual_grant') THEN
    RAISE EXCEPTION 'Invalid store';
  END IF;

  IF _tier IS NULL OR _tier NOT IN ('premium', 'plus', 'vip') THEN
    RAISE EXCEPTION 'Invalid subscription tier';
  END IF;

  IF _token_hash IS NULL OR char_length(_token_hash) < 16 THEN
    RAISE EXCEPTION 'Invalid purchase token hash';
  END IF;

  IF _duration_months IS NULL OR _duration_months < 1 THEN
    RAISE EXCEPTION 'Duration must be at least 1 month';
  END IF;

  _expires_at := _starts_at + (_duration_months || ' months')::interval;

  -- Replay check: prevent duplicate token redemption
  IF EXISTS (SELECT 1 FROM public.subscription_orders WHERE store = _store AND token_hash = _token_hash) THEN
    RAISE EXCEPTION 'Purchase token has already been redeemed';
  END IF;

  -- Insert order record
  INSERT INTO public.subscription_orders (
    user_id, store, order_id, product_id, token_hash, tier, amount_inr, starts_at, expires_at
  ) VALUES (
    _uid, _store, _order_id, _product_id, _token_hash, _tier, coalesce(_amount_inr, 0.00), _starts_at, _expires_at
  ) RETURNING id INTO _order_uuid;

  -- Update or insert user_subscriptions record
  INSERT INTO public.user_subscriptions (
    user_id, tier, status, starts_at, expires_at, auto_renew, updated_at
  ) VALUES (
    _user_id, _tier, 'active', _starts_at, _expires_at, true, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    tier = EXCLUDED.tier,
    status = 'active',
    starts_at = EXCLUDED.starts_at,
    expires_at = EXCLUDED.expires_at,
    auto_renew = EXCLUDED.auto_renew,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'order_id', _order_uuid,
    'tier', _tier,
    'expires_at', _expires_at
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.record_verified_purchase(text, text, text, text, text, text, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_purchase(text, text, text, text, text, text, numeric, integer) TO service_role;

-- 4. Defense-in-depth: harden swipes RLS policy against blocked pairs ----------
DROP POLICY IF EXISTS "paid members read received likes" ON public.swipes;
CREATE POLICY "paid members read received likes" ON public.swipes
  FOR SELECT TO authenticated
  USING (
    to_id = auth.uid()::text
    AND kind <> 'pass'
    AND public.get_active_subscription_tier(auth.uid()::text) IN ('premium', 'plus', 'vip')
    AND NOT public.is_blocked_pair(from_id, to_id)
  );

-- 5. Hardened purge_user_data: ensure subscription_orders are purged on account deletion
CREATE OR REPLACE FUNCTION public.purge_user_data(_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _t text := _uid::text;
BEGIN
  DELETE FROM public.matches WHERE user_a = _t OR user_b = _t;
  DELETE FROM public.swipes WHERE from_id = _t OR to_id = _t;
  DELETE FROM public.blocks WHERE blocker = _t OR blocked = _t;
  DELETE FROM public.user_daily_quotas WHERE user_id = _t;
  DELETE FROM public.subscription_orders WHERE user_id = _uid;
  DELETE FROM public.user_subscriptions WHERE user_id = _t;
  DELETE FROM public.account_state WHERE user_id = _uid;
  DELETE FROM public.photo_reviews WHERE owner_id = _t;
  DELETE FROM public.profiles WHERE id = _t;
  INSERT INTO public.admin_audit (admin_id, action, target, note)
  VALUES (_uid, 'account_self_deleted', _t, 'User data purged; auth user and media removed by delete-account function');
END $$;

REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;
