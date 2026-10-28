\set ON_ERROR_STOP on
-- 20260101006300: prepaid catalogue (Premium 1w/1m/2m, Plus 1m, VIP 1m), no cross-tier over-grant, top-ups,
-- downgrade refusal, expiry and refund. record_verified_google_purchase is service_role only (called by
-- verify-purchase after Google verification); run here as the owner.
INSERT INTO auth.users(id, email) VALUES
  ('78000000-0000-0000-0000-00000000000a', 'pp-a@x'), ('78000000-0000-0000-0000-00000000000b', 'pp-b@x'),
  ('78000000-0000-0000-0000-00000000000c', 'pp-c@x');
CREATE FUNCTION public.t78_buy(_uid text, _product text, _tok text, _days numeric, _start_ago_days numeric DEFAULT 0)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_verified_google_purchase(_uid, _product, encode(sha256(_tok::bytea), 'hex'), 'GPA.' || _tok,
    now() - make_interval(secs => (_start_ago_days * 86400)::int),
    now() - make_interval(secs => (_start_ago_days * 86400)::int) + make_interval(secs => (_days * 86400)::int),
    false, 'ACTIVE');
$$;
CREATE FUNCTION public.t78_sub(_uid text) RETURNS public.user_subscriptions LANGUAGE sql AS $$
  SELECT * FROM public.user_subscriptions WHERE user_id = _uid;
$$;

-- Removed products are refused; every catalogue product is accepted.
CALL public.expect_fail('pp: the 15-day plan is gone', $q$SELECT public.t78_buy('78000000-0000-0000-0000-00000000000a', 'chahat_pkg_299_15d', 'x15', 15)$q$);
CALL public.expect_fail('pp: the 7-day package id is gone (now chahat_premium_1w)', $q$SELECT public.t78_buy('78000000-0000-0000-0000-00000000000a', 'chahat_pkg_149_7d', 'x7', 7)$q$);
CALL public.expect_fail('pp: 3/6/12-month Premium are gone', $q$SELECT public.t78_buy('78000000-0000-0000-0000-00000000000a', 'chahat_premium_12m', 'x12', 365)$q$);

-- A: Premium 1 week, then a same-tier top-up of 1 month keeps the later end date.
SELECT public.t78_buy('78000000-0000-0000-0000-00000000000a', 'chahat_premium_1w', 'a1', 7);
INSERT INTO public.t_results SELECT 'pp: Premium 1 week grants premium, not auto-renewing',
  tier = 'premium' AND status = 'active' AND NOT auto_renew AND expires_at BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 hour',
  tier || ' ' || expires_at::text FROM public.t78_sub('78000000-0000-0000-0000-00000000000a');
SELECT public.t78_buy('78000000-0000-0000-0000-00000000000a', 'chahat_premium_2m', 'a2', 60);
INSERT INTO public.t_results SELECT 'pp: Premium top-up (2 months) extends to the later end date',
  tier = 'premium' AND expires_at > now() + interval '59 days', expires_at::text
FROM public.t78_sub('78000000-0000-0000-0000-00000000000a');

-- B: Premium 2 months, then VIP 1 month: VIP ends with the VIP plan (no 2 months of VIP).
SELECT public.t78_buy('78000000-0000-0000-0000-00000000000b', 'chahat_premium_2m', 'b1', 60);
SELECT public.t78_buy('78000000-0000-0000-0000-00000000000b', 'chahat_vip_1m', 'b2', 30);
INSERT INTO public.t_results SELECT 'pp: upgrading tiers never stretches the higher tier to the old end date',
  tier = 'vip' AND expires_at < now() + interval '31 days', tier || ' ' || expires_at::text
FROM public.t78_sub('78000000-0000-0000-0000-00000000000b');
CALL public.expect_fail('pp: a lower tier cannot be recorded while a higher one is active (Play refunds unacknowledged)',
  $q$SELECT public.t78_buy('78000000-0000-0000-0000-00000000000b', 'chahat_plus_1m', 'b3', 30)$q$);

-- Server entitlement follows the subscription (tier lookup is service-side).
INSERT INTO public.t_results SELECT 'pp: server tier for B is VIP', public.get_active_subscription_tier('78000000-0000-0000-0000-00000000000b') = 'vip', '';

-- C: Plus 1 month, refunded/revoked -> free immediately; an expired prepaid plan is free.
SELECT public.t78_buy('78000000-0000-0000-0000-00000000000c', 'chahat_plus_1m', 'c1', 30);
SELECT public.revoke_verified_google_purchase('78000000-0000-0000-0000-00000000000c', encode(sha256('c1'::bytea), 'hex'), 'REVOKED');
INSERT INTO public.t_results SELECT 'pp: a refunded (revoked) plan stops at once',
  public.get_active_subscription_tier('78000000-0000-0000-0000-00000000000c') = 'free', '';
UPDATE public.user_subscriptions SET expires_at = now() - interval '1 second' WHERE user_id = '78000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_results SELECT 'pp: an expired prepaid plan is free (no renewal)',
  public.get_active_subscription_tier('78000000-0000-0000-0000-00000000000a') = 'free', '';
-- Replaying the same verified token is idempotent and cannot move another account.
CALL public.expect_fail('pp: a token cannot be moved to another account',
  $q$SELECT public.t78_buy('78000000-0000-0000-0000-00000000000c', 'chahat_vip_1m', 'b2', 30)$q$);
