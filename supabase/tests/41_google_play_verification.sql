\set ON_ERROR_STOP on
-- Provider-verified purchase persistence, retry safety, revocation, and RPC access.

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'billing-a@x'),
  ('00000000-0000-0000-0000-0000000000e2', 'billing-b@x');
CREATE TEMP TABLE purchase_test_times AS
SELECT now() - interval '1 minute' AS starts_at,
       now() + interval '30 days' AS expires_at;

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
CALL public.expect_fail(
  'authenticated users cannot directly record verified purchases',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000e1', 'chahat_premium_1m', repeat('a',64),
    'order-a', now() - interval '1 minute', now() + interval '30 days', true, 'ACTIVE'
  )$q$
);
CALL public.expect_fail(
  'authenticated users cannot resolve purchase token owners',
  $q$SELECT public.get_google_purchase_owner(repeat('a',64))$q$
);
CALL public.expect_fail(
  'authenticated users cannot revoke verified purchases',
  $q$SELECT public.revoke_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000e1', repeat('a',64), 'REVOKED'
  )$q$
);
RESET ROLE;

SET ROLE service_role;
CREATE TEMP TABLE first_purchase AS
SELECT public.record_verified_google_purchase(
  '00000000-0000-0000-0000-0000000000e1',
  'chahat_premium_1m',
  repeat('a',64),
  'order-a',
  (SELECT starts_at FROM purchase_test_times),
  (SELECT expires_at FROM purchase_test_times),
  true,
  'ACTIVE'
) AS result;
INSERT INTO public.t_results
SELECT 'verified Play purchase creates premium entitlement',
  result->>'success' = 'true'
    AND result->>'tier' = 'premium'
    AND result->>'idempotent' = 'false',
  result::text
FROM first_purchase;

CREATE TEMP TABLE replay_purchase AS
SELECT public.record_verified_google_purchase(
  '00000000-0000-0000-0000-0000000000e1',
  'chahat_premium_1m',
  repeat('a',64),
  'order-a',
  (SELECT starts_at FROM purchase_test_times),
  (SELECT expires_at FROM purchase_test_times),
  true,
  'ACTIVE'
) AS result;
INSERT INTO public.t_results
SELECT 'same-account retry is idempotent',
  result->>'success' = 'true'
    AND result->>'idempotent' = 'true'
    AND (SELECT count(*) = 1 FROM public.subscription_orders WHERE token_hash = repeat('a',64)),
  result::text
FROM replay_purchase;

CALL public.expect_fail(
  'cross-account token replay is rejected',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000e2', 'chahat_premium_1m', repeat('a',64),
    'order-a', now() - interval '1 minute', now() + interval '31 days', true, 'ACTIVE'
  )$q$
);
CALL public.expect_fail(
  'token reuse for a different product is rejected',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000e1', 'chahat_vip_1m', repeat('a',64),
    'order-a', now() - interval '1 minute', now() + interval '31 days', true, 'ACTIVE'
  )$q$
);
CALL public.expect_fail(
  'stale expiry update for the same purchase is rejected',
  format(
    $q$SELECT public.record_verified_google_purchase(
      %L, %L, %L, %L, %L, %L, true, %L
    )$q$,
    '00000000-0000-0000-0000-0000000000e1',
    'chahat_premium_1m',
    repeat('a',64),
    'order-a',
    (SELECT starts_at FROM purchase_test_times),
    (SELECT expires_at - interval '1 day' FROM purchase_test_times),
    'ACTIVE'
  )
);
CALL public.expect_fail(
  'unsupported product cannot create an entitlement',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000e1', 'manual_grant', repeat('b',64),
    'order-b', now() - interval '1 minute', now() + interval '30 days', true, 'ACTIVE'
  )$q$
);
INSERT INTO public.t_results
SELECT 'legacy manual-grant RPC is removed',
  to_regprocedure('public.record_verified_purchase(text,text,text,text,text,text,numeric,integer)') IS NULL
    AND to_regprocedure('public.record_verified_purchase(text,text,text,text,text,text,integer,timestamptz,boolean)') IS NULL,
  'legacy purchase RPC overloads absent';

INSERT INTO public.t_results
SELECT 'RTDN owner lookup returns the account for an existing token',
  public.get_google_purchase_owner(repeat('a',64)) = '00000000-0000-0000-0000-0000000000e1'::uuid,
  public.get_google_purchase_owner(repeat('a',64))::text;

INSERT INTO public.t_results
SELECT 'verified revocation removes entitlement and retains token ownership',
  public.revoke_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000e1', repeat('a',64), 'REVOKED'
  )
  AND (SELECT status = 'expired' AND tier = 'free'
       FROM public.user_subscriptions
       WHERE user_id = '00000000-0000-0000-0000-0000000000e1')
  AND public.get_google_purchase_owner(repeat('a',64)) = '00000000-0000-0000-0000-0000000000e1'::uuid,
  'revoked; retained for audit';

RESET ROLE;
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000e1';
INSERT INTO public.t_results
SELECT 'account deletion retains purchase replay record without owner PII',
  count(*) = 1 AND bool_and(user_id IS NULL),
  coalesce(string_agg(coalesce(user_id::text, 'null'), ','), 'missing')
FROM public.subscription_orders
WHERE token_hash = repeat('a',64);
SET ROLE service_role;
CALL public.expect_fail(
  'deleted-account purchase token cannot be transferred',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000e2', 'chahat_premium_1m', repeat('a',64),
    'order-a', now() - interval '1 minute', now() + interval '31 days', true, 'ACTIVE'
  )$q$
);
RESET ROLE;
