\set ON_ERROR_STOP on
-- Current Google Play purchase RPC invariants after migrations 016 and 021.

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000d1','purchase-test@x'),
  ('00000000-0000-0000-0000-0000000000d2','purchase-other@x');
CREATE TEMP TABLE purchase_test_times AS
SELECT now() - interval '1 minute' AS starts_at,
       '2099-11-15T00:00:00Z'::timestamptz AS expires_at;
GRANT SELECT ON purchase_test_times TO service_role;

SET ROLE authenticated;
CALL public.expect_fail(
  'authenticated cannot execute verified purchase RPC',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'chahat_premium_1m', repeat('a',64),
    'GPA.test', now() - interval '1 minute', now() + interval '30 days', true, 'ACTIVE'
  )$q$
);
RESET ROLE;

SET ROLE service_role;
SET request.jwt.claim.role='service_role';
CALL public.expect_ok(
  'service role records a supported, unexpired Google Play product',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'chahat_premium_1m', repeat('a',64),
    'GPA.test', (SELECT starts_at FROM purchase_test_times),
    (SELECT expires_at FROM purchase_test_times), true, 'ACTIVE'
  )$q$
);

INSERT INTO public.t_results
SELECT 'same account retry is idempotent',
  result->>'success' = 'true'
    AND result->>'idempotent' = 'true'
    AND (SELECT count(*) = 1 FROM public.subscription_orders WHERE token_hash = repeat('a',64)),
  result::text
FROM (
  SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'chahat_premium_1m', repeat('a',64),
    'GPA.test', (SELECT starts_at FROM purchase_test_times),
    (SELECT expires_at FROM purchase_test_times), true, 'ACTIVE'
  ) AS result
) AS replay;

CALL public.expect_fail(
  'cross-account purchase-token replay is rejected',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000d2', 'chahat_premium_1m', repeat('a',64),
    'GPA.test', now() - interval '1 minute', '2100-11-15T00:00:00Z', true, 'ACTIVE'
  )$q$
);
CALL public.expect_fail(
  'purchase token cannot be reused for another product',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'chahat_vip_1m', repeat('a',64),
    'GPA.test', now() - interval '1 minute', '2100-11-15T00:00:00Z', true, 'ACTIVE'
  )$q$
);
CALL public.expect_fail(
  'stale purchase expiry update is rejected',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'chahat_premium_1m', repeat('a',64),
    'GPA.test', (SELECT starts_at FROM purchase_test_times),
    '2099-10-15T00:00:00Z', true, 'ACTIVE'
  )$q$
);
CALL public.expect_fail(
  'unsupported product cannot create an entitlement',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'manual_grant', repeat('b',64),
    'GPA.manual', now() - interval '1 minute', '2099-11-15T00:00:00Z', true, 'ACTIVE'
  )$q$
);
CALL public.expect_ok(
  'higher tier purchase may upgrade an active lower tier',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'chahat_vip_1m', repeat('e',64),
    'GPA.vip', now(), '2100-11-15T00:00:00Z', true, 'ACTIVE'
  )$q$
);
CALL public.expect_fail(
  'lower tier event cannot downgrade an active higher tier',
  $q$SELECT public.record_verified_google_purchase(
    '00000000-0000-0000-0000-0000000000d1', 'chahat_premium_1m', repeat('f',64),
    'GPA.downgrade', now() + interval '1 second', '2101-11-15T00:00:00Z', true, 'ACTIVE'
  )$q$
);
INSERT INTO public.t_results
SELECT 'legacy purchase RPC signatures are removed',
  to_regprocedure('public.record_verified_purchase(text,text,text,text,text,text,numeric,integer)') IS NULL
    AND to_regprocedure('public.record_verified_purchase(text,text,text,text,text,text,integer,timestamptz,boolean)') IS NULL,
  'legacy RPC overloads absent';

RESET request.jwt.claim.role;
RESET ROLE;
