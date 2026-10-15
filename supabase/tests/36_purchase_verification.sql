\set ON_ERROR_STOP on
-- Purchase recording accepts only server-verified Google Play catalog entries and provider expiry.

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000d1','purchase-test@x'),
  ('00000000-0000-0000-0000-0000000000d2','purchase-other@x');

SET ROLE authenticated;
CALL public.expect_fail(
  'authenticated cannot execute verified purchase RPC',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.test',
    'chahat_premium_1m', 'premium', repeat('a',64), 1, now() + interval '1 month', true
  )$q$
);
RESET ROLE;

SET ROLE service_role;
SET request.jwt.claim.role='service_role';
CALL public.expect_ok(
  'service role records allowlisted product with provider expiry',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.test',
    'chahat_premium_1m', 'premium', repeat('a',64), 1, '2099-11-15T00:00:00Z', false
  )$q$
);
CALL public.expect_ok(
  'same account retry of same verified order is idempotent',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.test',
    'chahat_premium_1m', 'premium', repeat('a',64), 1, '2099-11-15T00:00:00Z', false
  )$q$
);
INSERT INTO public.t_results
SELECT
  'same account replay explicitly reports idempotent success',
  result->>'success' = 'true' AND result->>'idempotent' = 'true',
  result::text
FROM (
  SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.test',
    'chahat_premium_1m', 'premium', repeat('a',64), 1, '2099-11-15T00:00:00Z', false
  ) AS result
) AS replay;
CALL public.expect_ok(
  'same token with a newer verified renewal extends entitlement',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.renewal',
    'chahat_premium_1m', 'premium', repeat('a',64), 1, '2100-11-15T00:00:00Z', true
  )$q$
);
CALL public.expect_ok(
  'idempotent cancellation retry updates provider auto-renew state',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.renewal',
    'chahat_premium_1m', 'premium', repeat('a',64), 1, '2100-11-15T00:00:00Z', false
  )$q$
);
INSERT INTO public.t_results
SELECT
  'idempotent cancellation retry persists auto-renew disabled',
  coalesce(bool_and(NOT auto_renew), false),
  coalesce(bool_and(NOT auto_renew)::text, 'no subscription row')
FROM public.user_subscriptions
WHERE user_id = '00000000-0000-0000-0000-0000000000d1';
CALL public.expect_fail(
  'stale verified retry cannot shorten the entitlement',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.test',
    'chahat_premium_1m', 'premium', repeat('a',64), 1, '2099-11-15T00:00:00Z', false
  )$q$
);
CALL public.expect_fail(
  'same token cannot be replayed to a different account',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d2', 'google_play', 'GPA.renewal',
    'chahat_premium_1m', 'premium', repeat('a',64), 1, '2101-11-15T00:00:00Z', true
  )$q$
);
CALL public.expect_fail(
  'service role cannot record unsupported store',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'manual_grant', 'GPA.test',
    'chahat_premium_1m', 'premium', repeat('b',64), 1, now() + interval '1 month', true
  )$q$
);
CALL public.expect_fail(
  'service role cannot mismatch tier and product',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.test',
    'chahat_premium_1m', 'vip', repeat('c',64), 1, now() + interval '1 month', true
  )$q$
);
CALL public.expect_fail(
  'service role cannot record expired provider purchase',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.test',
    'chahat_premium_1m', 'premium', repeat('d',64), 1, now() - interval '1 second', true
  )$q$
);
CALL public.expect_fail(
  'service role cannot change product for a redeemed token',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.test',
    'chahat_plus_1m', 'plus', repeat('a',64), 1, '2101-11-15T00:00:00Z', true
  )$q$
);
CALL public.expect_ok(
  'higher tier purchase may upgrade an active lower tier',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.vip',
    'chahat_vip_1m', 'vip', repeat('e',64), 1, '2100-11-15T00:00:00Z', true
  )$q$
);
CALL public.expect_fail(
  'lower tier event cannot downgrade an active higher tier',
  $q$SELECT public.record_verified_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'google_play', 'GPA.downgrade',
    'chahat_premium_1m', 'premium', repeat('f',64), 1, '2101-11-15T00:00:00Z', true
  )$q$
);
RESET request.jwt.claim.role;
RESET ROLE;

INSERT INTO public.t_results
SELECT
  'purchase row uses catalog amount and provider expiry',
  coalesce(bool_and(
    amount_inr = 99
        AND expires_at = '2100-11-15T00:00:00Z'::timestamptz
        AND order_id = 'GPA.renewal'
  ), false),
  coalesce(jsonb_agg(jsonb_build_object('amount', amount_inr, 'expires_at', expires_at))::text, '[]')
FROM public.subscription_orders
WHERE user_id = '00000000-0000-0000-0000-0000000000d1'::uuid
  AND token_hash = repeat('a',64);

INSERT INTO public.t_results
SELECT
  'subscription row preserves provider auto-renew state',
  coalesce(bool_and(auto_renew), false),
  coalesce(bool_and(auto_renew)::text, 'no subscription row')
FROM public.user_subscriptions
WHERE user_id = '00000000-0000-0000-0000-0000000000d1';
