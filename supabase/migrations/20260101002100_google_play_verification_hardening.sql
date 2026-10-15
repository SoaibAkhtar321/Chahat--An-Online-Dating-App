-- Google Play is the only supported store. Persist provider-verified facts and
-- make retries idempotent without permitting token transfer across accounts.

ALTER TABLE public.subscription_orders
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.subscription_orders
  DROP CONSTRAINT subscription_orders_user_id_fkey;
ALTER TABLE public.subscription_orders
  ADD CONSTRAINT subscription_orders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.subscription_orders
  ADD COLUMN provider_state text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN auto_renew boolean NOT NULL DEFAULT false,
  ADD COLUMN verified_at timestamptz;

ALTER TABLE public.user_subscriptions
  ADD COLUMN source_order_id uuid REFERENCES public.subscription_orders(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS public.record_verified_purchase(
  text, text, text, text, text, text, numeric, integer
);
DROP FUNCTION IF EXISTS public.record_verified_purchase(
  text, text, text, text, text, text, integer, timestamptz, boolean
);

CREATE OR REPLACE FUNCTION public.record_verified_google_purchase(
  _user_id text,
  _product_id text,
  _token_hash text,
  _order_id text,
  _starts_at timestamptz,
  _expires_at timestamptz,
  _auto_renew boolean,
  _provider_state text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid;
  _tier text;
  _months integer;
  _order public.subscription_orders;
  _subscription public.user_subscriptions;
  _entitlement_updated boolean := false;
  _was_replay boolean := false;
  _tier_rank integer;
  _current_tier_rank integer;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'User ID required'; END IF;
  _uid := _user_id::uuid;
  IF _product_id IS NULL THEN RAISE EXCEPTION 'Product ID required'; END IF;
  IF _product_id = 'chahat_premium_1m' THEN _tier := 'premium'; _months := 1;
  ELSIF _product_id = 'chahat_premium_3m' THEN _tier := 'premium'; _months := 3;
  ELSIF _product_id = 'chahat_premium_6m' THEN _tier := 'premium'; _months := 6;
  ELSIF _product_id = 'chahat_premium_12m' THEN _tier := 'premium'; _months := 12;
  ELSIF _product_id = 'chahat_plus_1m' THEN _tier := 'plus'; _months := 1;
  ELSIF _product_id = 'chahat_vip_1m' THEN _tier := 'vip'; _months := 1;
  ELSE RAISE EXCEPTION 'Unsupported Google Play product'; END IF;
  _tier_rank := CASE _tier WHEN 'premium' THEN 1 WHEN 'plus' THEN 2 WHEN 'vip' THEN 3 END;

  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid purchase token hash';
  END IF;
  IF _starts_at IS NULL OR _expires_at IS NULL OR _starts_at > now() + interval '5 minutes'
     OR _expires_at <= now() OR _expires_at <= _starts_at THEN
    RAISE EXCEPTION 'Purchase is not currently entitled';
  END IF;
  IF _provider_state IS NULL OR _provider_state NOT IN ('ACTIVE', 'IN_GRACE_PERIOD', 'CANCELED') THEN
    RAISE EXCEPTION 'Purchase state is not entitled';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('google_play|' || _token_hash, 0));
  SELECT * INTO _order FROM public.subscription_orders
  WHERE store = 'google_play' AND token_hash = _token_hash
  FOR UPDATE;

  IF FOUND THEN
    _was_replay := true;
    IF _order.user_id IS DISTINCT FROM _uid THEN
      RAISE EXCEPTION 'Purchase token is already associated with another account';
    END IF;
    IF _order.product_id IS DISTINCT FROM _product_id THEN
      RAISE EXCEPTION 'Purchase token product does not match';
    END IF;
    IF _starts_at < _order.starts_at OR _expires_at < _order.expires_at THEN
      RAISE EXCEPTION 'Stale purchase update rejected';
    END IF;
    UPDATE public.subscription_orders
      SET order_id = coalesce(_order_id, order_id),
          expires_at = greatest(expires_at, _expires_at),
          provider_state = _provider_state,
          auto_renew = coalesce(_auto_renew, false),
          verified_at = now()
      WHERE id = _order.id
      RETURNING * INTO _order;
  ELSE
    INSERT INTO public.subscription_orders (
      user_id, store, order_id, product_id, token_hash, tier, amount_inr,
      starts_at, expires_at, provider_state, auto_renew, verified_at
    ) VALUES (
      _uid, 'google_play', _order_id, _product_id, _token_hash, _tier, 0,
      _starts_at, _expires_at, _provider_state, coalesce(_auto_renew, false), now()
    ) RETURNING * INTO _order;
  END IF;

  SELECT * INTO _subscription FROM public.user_subscriptions
  WHERE user_id = _uid::text FOR UPDATE;

  IF FOUND
     AND _subscription.status = 'active'
     AND (_subscription.expires_at IS NULL OR _subscription.expires_at > now()) THEN
    _current_tier_rank := CASE _subscription.tier
      WHEN 'premium' THEN 1
      WHEN 'plus' THEN 2
      WHEN 'vip' THEN 3
      ELSE 0
    END;
    IF _tier_rank < _current_tier_rank THEN
      RAISE EXCEPTION 'Purchase cannot downgrade a newer active subscription';
    END IF;
  END IF;

  IF _subscription.user_id IS NULL THEN
    INSERT INTO public.user_subscriptions (
      user_id, tier, status, starts_at, expires_at, auto_renew, updated_at, source_order_id
    ) VALUES (
      _uid::text, _tier, 'active', _starts_at, _expires_at, coalesce(_auto_renew, false), now(), _order.id
    );
    _entitlement_updated := true;
  ELSIF _subscription.status <> 'active'
     OR (_subscription.expires_at IS NOT NULL AND _subscription.expires_at <= now())
     OR _subscription.source_order_id = _order.id
     OR (_starts_at >= _subscription.starts_at AND _expires_at >= coalesce(_subscription.expires_at, '-infinity'::timestamptz)) THEN
    UPDATE public.user_subscriptions
      SET tier = _tier,
          status = 'active',
          starts_at = _starts_at,
          expires_at = greatest(_expires_at, coalesce(_subscription.expires_at, _expires_at)),
          auto_renew = coalesce(_auto_renew, false),
          updated_at = now(),
          source_order_id = _order.id
      WHERE user_id = _uid::text;
    _entitlement_updated := true;
  END IF;

  SELECT * INTO _subscription FROM public.user_subscriptions WHERE user_id = _uid::text;
  RETURN jsonb_build_object(
    'success', true,
    'idempotent', _was_replay,
    'entitlement_updated', _entitlement_updated,
    'tier', CASE WHEN _subscription.status = 'active'
                      AND (_subscription.expires_at IS NULL OR _subscription.expires_at > now())
                 THEN _subscription.tier ELSE 'free' END,
    'expires_at', _subscription.expires_at,
    'order_id', _order.id
  );
END
$$;

CREATE OR REPLACE FUNCTION public.revoke_verified_google_purchase(
  _user_id text,
  _token_hash text,
  _provider_state text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid;
  _order public.subscription_orders;
  _replacement public.subscription_orders;
BEGIN
  IF _user_id IS NULL OR _token_hash IS NULL OR _provider_state IS NULL
     OR _provider_state NOT IN ('EXPIRED', 'ON_HOLD', 'PAUSED', 'REVOKED', 'PENDING') THEN
    RAISE EXCEPTION 'Invalid purchase revocation';
  END IF;
  _uid := _user_id::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('google_play|' || _token_hash, 0));
  SELECT * INTO _order FROM public.subscription_orders
  WHERE store = 'google_play' AND token_hash = _token_hash AND user_id = _uid
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.subscription_orders
    SET provider_state = _provider_state, verified_at = now()
    WHERE id = _order.id;

  IF EXISTS (
    SELECT 1 FROM public.user_subscriptions
    WHERE user_id = _uid::text AND source_order_id = _order.id
  ) THEN
    SELECT * INTO _replacement FROM public.subscription_orders
    WHERE user_id = _uid AND store = 'google_play'
      AND id <> _order.id AND verified_at IS NOT NULL
      AND provider_state IN ('ACTIVE', 'IN_GRACE_PERIOD', 'CANCELED')
      AND expires_at > now()
    ORDER BY starts_at DESC, expires_at DESC
    LIMIT 1;

    IF _replacement.id IS NULL THEN
      UPDATE public.user_subscriptions
        SET tier = 'free', status = 'expired', expires_at = now(),
            auto_renew = false, updated_at = now(), source_order_id = _order.id
        WHERE user_id = _uid::text AND source_order_id = _order.id;
    ELSE
      UPDATE public.user_subscriptions
        SET tier = _replacement.tier, status = 'active',
            starts_at = _replacement.starts_at, expires_at = _replacement.expires_at,
            auto_renew = _replacement.auto_renew, updated_at = now(),
            source_order_id = _replacement.id
        WHERE user_id = _uid::text AND source_order_id = _order.id;
    END IF;
  END IF;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.get_google_purchase_owner(_token_hash text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT user_id
  FROM public.subscription_orders
  WHERE store = 'google_play'
    AND token_hash = _token_hash
    AND user_id IS NOT NULL
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.record_verified_google_purchase(text, text, text, text, timestamptz, timestamptz, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_verified_google_purchase(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_google_purchase_owner(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_google_purchase(text, text, text, text, timestamptz, timestamptz, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_verified_google_purchase(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_google_purchase_owner(text) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_user_data(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _t text := _uid::text;
BEGIN
  DELETE FROM public.video_calls WHERE caller_id = _uid OR recipient_id = _uid;
  DELETE FROM public.discovery_locations WHERE user_id = _uid;
  DELETE FROM public.matches WHERE user_a = _t OR user_b = _t;
  DELETE FROM public.swipes WHERE from_id = _t OR to_id = _t;
  DELETE FROM public.blocks WHERE blocker = _t OR blocked = _t;
  DELETE FROM public.user_daily_quotas WHERE user_id = _t;
  DELETE FROM public.user_subscriptions WHERE user_id = _t;
  DELETE FROM public.account_state WHERE user_id = _uid;
  DELETE FROM public.photo_reviews WHERE owner_id = _t;
  DELETE FROM public.profiles WHERE id = _t;
  INSERT INTO public.admin_audit (admin_id, action, target, note)
  VALUES (_uid, 'account_self_deleted', _t, 'User data purged; verified purchase history retained for audit');
END
$$;

REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;
