-- 20260101006300_prepaid_plan_catalog.sql
-- Plan catalogue decision (2026-10-28): one pricing system, all plans PREPAID (no auto-renewal).
--   Premium: chahat_premium_1w (1 week), chahat_premium_1m (1 month), chahat_premium_2m (2 months)
--   Plus:    chahat_plus_1m (1 month)
--   VIP:     chahat_vip_1m (1 month)
-- Removed: the 7/15-day and ₹499 "packages" and the 3/6/12-month Premium products (never sold; pre-launch).
-- Prices live in Play Console only; the server never trusts a price or duration from the app, and the end date
-- is Google's verified expiry.
-- Also fixes an over-grant: buying a higher tier while a lower one was active gave the higher tier until the
-- LATER of the two end dates (e.g. Premium 2 months + VIP 1 month = VIP for 2 months). A tier change now uses
-- the new plan's own end date; a same-tier prepaid top-up still keeps the later end date.
-- And fixes the reverse: a higher-tier purchase that ended before the current lower-tier plan was recorded but
-- never applied (the member paid for VIP and stayed on Premium).
-- Signature, grants and every other rule of record_verified_google_purchase are unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_verified_google_purchase(_user_id text, _product_id text, _token_hash text, _order_id text, _starts_at timestamp with time zone, _expires_at timestamp with time zone, _auto_renew boolean, _provider_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
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
  -- Catalog (20260101006300): prepaid, non-renewing plans only. Premium: 1 week / 1 month / 2 months;
  -- Plus and VIP: 1 month. Durations come from Google's verified expiry, never from this table.
  IF _product_id IN ('chahat_premium_1w', 'chahat_premium_1m', 'chahat_premium_2m') THEN _tier := 'premium'; _months := 1;
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
     -- 006300: a verified purchase of a HIGHER tier always takes effect (it used to be ignored when it ended
     -- before the current lower-tier plan, so the member paid and got nothing).
     OR _tier_rank > coalesce(_current_tier_rank, 0)
     OR (_starts_at >= _subscription.starts_at AND _expires_at >= coalesce(_subscription.expires_at, '-infinity'::timestamptz)) THEN
    UPDATE public.user_subscriptions
      SET tier = _tier,
          status = 'active',
          starts_at = _starts_at,
          -- Same tier: a prepaid top-up keeps the later end date. Different (higher) tier: the new plan's own end
          -- date; time left on a cheaper plan is never converted into time on a more expensive one.
          expires_at = CASE WHEN _subscription.tier = _tier
                            THEN greatest(_expires_at, coalesce(_subscription.expires_at, _expires_at))
                            ELSE _expires_at END,
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
$function$;

REVOKE EXECUTE ON FUNCTION public.record_verified_google_purchase(text, text, text, text, timestamptz, timestamptz, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_google_purchase(text, text, text, text, timestamptz, timestamptz, boolean, text) TO service_role;

COMMIT;
