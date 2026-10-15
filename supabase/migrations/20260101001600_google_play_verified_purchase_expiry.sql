-- Only the Google Play verification Edge Function may record purchases. Store SKU and
-- entitlement mapping are revalidated here, and expiration comes from Google's API response.

BEGIN;

DROP FUNCTION public.record_verified_purchase(
  text, text, text, text, text, text, numeric, integer
);

CREATE FUNCTION public.record_verified_purchase(
  _user_id text,
  _store text,
  _order_id text,
  _product_id text,
  _tier text,
  _token_hash text,
  _duration_months integer,
  _verified_expires_at timestamptz,
  _auto_renew boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _uid uuid;
  _starts_at timestamptz := now();
  _order_uuid uuid;
  _verified_amount numeric(10,2);
  _existing public.subscription_orders%ROWTYPE;
  _current public.user_subscriptions%ROWTYPE;
  _tier_rank integer;
  _current_tier_rank integer;
  _idempotent boolean := false;
  _has_current boolean := false;
  _has_existing boolean := false;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'User ID required'; END IF;
  _uid := _user_id::uuid;

  IF _store IS DISTINCT FROM 'google_play' THEN
    RAISE EXCEPTION 'Invalid or unsupported store';
  END IF;

  _verified_amount := CASE
    WHEN _product_id = 'chahat_premium_1m' AND _tier = 'premium' AND _duration_months = 1 THEN 99
    WHEN _product_id = 'chahat_premium_3m' AND _tier = 'premium' AND _duration_months = 3 THEN 249
    WHEN _product_id = 'chahat_premium_6m' AND _tier = 'premium' AND _duration_months = 6 THEN 449
    WHEN _product_id = 'chahat_premium_12m' AND _tier = 'premium' AND _duration_months = 12 THEN 799
    WHEN _product_id = 'chahat_plus_1m' AND _tier = 'plus' AND _duration_months = 1 THEN 199
    WHEN _product_id = 'chahat_vip_1m' AND _tier = 'vip' AND _duration_months = 1 THEN 399
    ELSE NULL
  END;
  IF _verified_amount IS NULL THEN
    RAISE EXCEPTION 'Unrecognized product or entitlement mapping';
  END IF;

  IF _token_hash IS NULL OR char_length(_token_hash) <> 64 THEN
    RAISE EXCEPTION 'Invalid purchase token hash';
  END IF;

  IF _verified_expires_at IS NULL OR _verified_expires_at <= _starts_at THEN
    RAISE EXCEPTION 'Verified purchase expiration must be in the future';
  END IF;
  IF _auto_renew IS NULL THEN
    RAISE EXCEPTION 'Verified auto-renew state is required';
  END IF;

  _tier_rank := CASE _tier WHEN 'premium' THEN 1 WHEN 'plus' THEN 2 WHEN 'vip' THEN 3 END;

  -- Serialize entitlement changes per account so concurrent purchase/retry requests cannot
  -- overwrite a newer subscription state.
  PERFORM pg_advisory_xact_lock(hashtext(_uid::text));
  -- Serialize redemption of one store token across accounts as well. This makes the
  -- subsequent ownership check deterministic rather than relying only on the unique index.
  PERFORM pg_advisory_xact_lock(hashtext(_store || ':' || _token_hash));
  SELECT * INTO _current
  FROM public.user_subscriptions
  WHERE user_id = _uid::text
  FOR UPDATE;
  _has_current := FOUND;

  SELECT * INTO _existing
  FROM public.subscription_orders
  WHERE store = _store AND token_hash = _token_hash
  FOR UPDATE;
  _has_existing := FOUND;

  IF _has_existing THEN
    IF _existing.user_id <> _uid THEN
      RAISE EXCEPTION 'Purchase token has already been redeemed by another account';
    END IF;
    IF _existing.product_id <> _product_id OR _existing.tier <> _tier THEN
      RAISE EXCEPTION 'Purchase token does not match the previously verified product';
    END IF;
    IF _verified_expires_at < _existing.expires_at THEN
      RAISE EXCEPTION 'Stale purchase retry cannot shorten a verified entitlement';
    END IF;
    _order_uuid := _existing.id;
    _idempotent := _verified_expires_at = _existing.expires_at
      AND _order_id IS NOT DISTINCT FROM _existing.order_id;

    IF _verified_expires_at = _existing.expires_at AND NOT _idempotent THEN
      RAISE EXCEPTION 'Purchase token was reported with a conflicting order';
    END IF;

    IF _idempotent THEN
      IF _has_current
        AND _current.tier = _existing.tier
        AND _current.expires_at = _existing.expires_at THEN
        UPDATE public.user_subscriptions
        SET auto_renew = _auto_renew, updated_at = now()
        WHERE user_id = _uid::text;
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'order_id', _existing.id,
        'tier', CASE
          WHEN _has_current AND _current.status = 'active' AND _current.expires_at > _starts_at
            THEN _current.tier
          ELSE _existing.tier
        END,
        'expires_at', CASE
          WHEN _has_current AND _current.status = 'active' AND _current.expires_at > _starts_at
            THEN _current.expires_at
          ELSE _existing.expires_at
        END
      );
    END IF;

  END IF;

  IF _has_current AND _current.status = 'active' AND _current.expires_at > _starts_at THEN
    _current_tier_rank := CASE _current.tier
      WHEN 'premium' THEN 1
      WHEN 'plus' THEN 2
      WHEN 'vip' THEN 3
      ELSE 0
    END;
    IF _verified_expires_at < _current.expires_at THEN
      RAISE EXCEPTION 'Stale purchase cannot replace a newer active subscription';
    END IF;
    IF _tier_rank < _current_tier_rank THEN
      RAISE EXCEPTION 'Purchase cannot downgrade a newer active subscription';
    END IF;
  END IF;

  IF _has_existing THEN
    UPDATE public.subscription_orders
    SET order_id = _order_id,
        amount_inr = _verified_amount,
        expires_at = _verified_expires_at
    WHERE id = _existing.id;
  ELSE
    INSERT INTO public.subscription_orders (
      user_id, store, order_id, product_id, token_hash, tier, amount_inr, starts_at, expires_at
    ) VALUES (
      _uid, _store, _order_id, _product_id, _token_hash, _tier,
      _verified_amount, _starts_at, _verified_expires_at
    ) RETURNING id INTO _order_uuid;
  END IF;

  INSERT INTO public.user_subscriptions (
    user_id, tier, status, starts_at, expires_at, auto_renew, updated_at
  ) VALUES (
    _user_id, _tier, 'active', _starts_at, _verified_expires_at, _auto_renew, now()
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
    'idempotent', _idempotent,
    'order_id', _order_uuid,
    'tier', _tier,
    'expires_at', _verified_expires_at
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.record_verified_purchase(
  text, text, text, text, text, text, integer, timestamptz, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_purchase(
  text, text, text, text, text, text, integer, timestamptz, boolean
) TO service_role;

COMMIT;
