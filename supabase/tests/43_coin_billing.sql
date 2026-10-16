\set ON_ERROR_STOP on
-- Phase 4: coin wallets, append-only ledger, server-metered call billing.
-- Runs after 10_functional_rls.sql (uses public.t_results, expect_fail, test_complete_profile).
-- Time is simulated by shifting a call's accepted_at / free_call_until back, as the table owner.

-- Deterministic settings regardless of earlier suites.
INSERT INTO public.app_settings (key, value) VALUES
  ('coin_value_paise', '50'::jsonb),
  ('call_rate_audio_coins_per_minute', '4'::jsonb),
  ('call_rate_video_coins_per_minute', '10'::jsonb),
  ('call_free_seconds', '60'::jsonb),
  ('call_extension_lead_seconds', '20'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE TABLE public.t_calls (label text PRIMARY KEY, id uuid);
CREATE TABLE public.t_json (label text, result jsonb);
GRANT ALL ON public.t_calls, public.t_json TO PUBLIC;

CREATE FUNCTION public.t_shift(_label text, _secs integer) RETURNS void LANGUAGE sql AS $$
  UPDATE public.video_calls
  SET accepted_at = accepted_at - make_interval(secs => _secs),
      free_call_until = CASE WHEN free_call_until IS NULL THEN NULL
                             ELSE free_call_until - make_interval(secs => _secs) END
  WHERE id = (SELECT id FROM public.t_calls WHERE label = _label);
$$;

CREATE FUNCTION public.t_ledger_sum(_uid uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(amount), 0)::bigint FROM public.coin_transactions WHERE user_id = _uid;
$$;
CREATE FUNCTION public.t_balance(_uid uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT balance FROM public.coin_wallets WHERE user_id = _uid), 0);
$$;

-- ---------- Fixtures ----------
INSERT INTO auth.users(id, email) VALUES
  ('70000000-0000-0000-0000-00000000000a', 'coin-a@x'),  -- free caller
  ('70000000-0000-0000-0000-00000000000b', 'coin-b@x'),  -- free recipient
  ('70000000-0000-0000-0000-00000000000c', 'coin-c@x'),  -- premium caller
  ('70000000-0000-0000-0000-00000000000e', 'coin-e@x'),  -- premium recipient
  ('70000000-0000-0000-0000-00000000000f', 'coin-f@x'),  -- bystander
  ('70000000-0000-0000-0000-0000000000f1', 'coin-x@x');  -- deleted later (cascade test)
CALL public.test_complete_profile('70000000-0000-0000-0000-00000000000a', 'CoinA', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('70000000-0000-0000-0000-00000000000b', 'CoinB', '1996-01-01', 'woman', 'man');
CALL public.test_complete_profile('70000000-0000-0000-0000-00000000000c', 'CoinC', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('70000000-0000-0000-0000-00000000000e', 'CoinE', '1996-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('dddddddd-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000b'),
  ('dddddddd-0000-0000-0000-0000000000a2', '70000000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-00000000000c'),
  ('dddddddd-0000-0000-0000-0000000000a3', '70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000e');
INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at) VALUES
  ('70000000-0000-0000-0000-00000000000c', 'premium', 'active', now() + interval '30 days'),
  ('70000000-0000-0000-0000-00000000000e', 'vip', 'active', now() + interval '30 days');

-- ================= A. Wallet access control and RLS =================
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_json SELECT 'wallet_empty', public.get_my_wallet();
RESET ROLE;
INSERT INTO public.t_results
SELECT 'wallet: a user with no wallet row reads balance 0 and the configured rates',
  (result->>'balance')::bigint = 0 AND (result->>'audio_coins_per_minute')::int = 4
    AND (result->>'video_coins_per_minute')::int = 10 AND (result->>'free_call_seconds')::int = 60
    AND (result->>'coin_value_paise')::int = 50,
  result::text
FROM public.t_json WHERE label = 'wallet_empty';

SET ROLE anon;
CALL public.expect_fail('wallet: anon cannot call get_my_wallet', 'SELECT public.get_my_wallet()');
CALL public.expect_fail('wallet: anon cannot read wallets', 'SELECT * FROM public.coin_wallets');
CALL public.expect_fail('wallet: anon cannot read the ledger', 'SELECT * FROM public.coin_transactions');
RESET ROLE;

-- Fund A (service_role is the only role allowed to credit, and only through the purchase function).
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
INSERT INTO public.t_json SELECT 'credit_a',
  public.credit_coins_from_purchase('70000000-0000-0000-0000-00000000000a', 100, 'ORDER-TEST-0001');
INSERT INTO public.t_json SELECT 'credit_a_replay',
  public.credit_coins_from_purchase('70000000-0000-0000-0000-00000000000a', 100, 'ORDER-TEST-0001');
CALL public.expect_fail('ledger: same order reference with a different amount is rejected',
  $q$SELECT public.credit_coins_from_purchase('70000000-0000-0000-0000-00000000000a', 101, 'ORDER-TEST-0001')$q$);
CALL public.expect_fail('ledger: same order reference for a different user is rejected',
  $q$SELECT public.credit_coins_from_purchase('70000000-0000-0000-0000-00000000000b', 100, 'ORDER-TEST-0001')$q$);
CALL public.expect_fail('ledger: zero credit rejected',
  $q$SELECT public.credit_coins_from_purchase('70000000-0000-0000-0000-00000000000a', 0, 'ORDER-TEST-0002')$q$);
CALL public.expect_fail('ledger: negative credit rejected',
  $q$SELECT public.credit_coins_from_purchase('70000000-0000-0000-0000-00000000000a', -5, 'ORDER-TEST-0003')$q$);
CALL public.expect_fail('ledger: absurdly large credit rejected',
  $q$SELECT public.credit_coins_from_purchase('70000000-0000-0000-0000-00000000000a', 100000001, 'ORDER-TEST-0004')$q$);
CALL public.expect_fail('ledger: malformed order reference rejected',
  $q$SELECT public.credit_coins_from_purchase('70000000-0000-0000-0000-00000000000a', 5, 'short')$q$);
CALL public.expect_fail('ledger: unknown user cannot be credited',
  $q$SELECT public.credit_coins_from_purchase('70000000-0000-0000-0000-0000000000ee', 5, 'ORDER-TEST-0005')$q$);
-- service_role must not be able to bypass the primitives or edit balances directly.
CALL public.expect_fail('security: service_role cannot call apply_coin_transaction',
  $q$SELECT public.apply_coin_transaction('70000000-0000-0000-0000-00000000000a', 'grant', 50, 'service-grant-1')$q$);
CALL public.expect_fail('security: service_role cannot UPDATE a wallet balance',
  $q$UPDATE public.coin_wallets SET balance = 999999 WHERE user_id = '70000000-0000-0000-0000-00000000000a'$q$);
CALL public.expect_fail('security: service_role cannot INSERT a wallet',
  $q$INSERT INTO public.coin_wallets(user_id, balance) VALUES ('70000000-0000-0000-0000-00000000000b', 500)$q$);
CALL public.expect_fail('security: service_role cannot INSERT ledger rows',
  $q$INSERT INTO public.coin_transactions(user_id, kind, amount, balance_after, idempotency_key)
     VALUES ('70000000-0000-0000-0000-00000000000b', 'grant', 5, 5, 'service-direct-1')$q$);
RESET ROLE;

INSERT INTO public.t_results
SELECT 'ledger: verified purchase credits the wallet once',
  (c->>'applied')::boolean AND (c->>'balance')::bigint = 100 AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 100,
  c::text
FROM (SELECT result AS c FROM public.t_json WHERE label = 'credit_a') q;
INSERT INTO public.t_results
SELECT 'idempotency: replayed purchase is a no-op',
  NOT (c->>'applied')::boolean AND (c->>'replayed')::boolean AND (c->>'balance')::bigint = 100
    AND (SELECT count(*) FROM public.coin_transactions
         WHERE user_id = '70000000-0000-0000-0000-00000000000a' AND kind = 'purchase') = 1,
  c::text
FROM (SELECT result AS c FROM public.t_json WHERE label = 'credit_a_replay') q;

-- Clients: no writes anywhere, no privileged functions.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
CALL public.expect_fail('security: client cannot UPDATE own wallet',
  $q$UPDATE public.coin_wallets SET balance = 1000000 WHERE user_id = auth.uid()$q$);
CALL public.expect_fail('security: client cannot INSERT a wallet',
  $q$INSERT INTO public.coin_wallets(user_id, balance) VALUES (auth.uid(), 1000000)$q$);
CALL public.expect_fail('security: client cannot DELETE own wallet',
  $q$DELETE FROM public.coin_wallets WHERE user_id = auth.uid()$q$);
CALL public.expect_fail('security: client cannot INSERT ledger rows',
  $q$INSERT INTO public.coin_transactions(user_id, kind, amount, balance_after, idempotency_key)
     VALUES (auth.uid(), 'grant', 999, 1099, 'client-forged-credit')$q$);
CALL public.expect_fail('security: client cannot UPDATE ledger rows',
  $q$UPDATE public.coin_transactions SET amount = 5000 WHERE user_id = auth.uid()$q$);
CALL public.expect_fail('security: client cannot DELETE ledger rows',
  $q$DELETE FROM public.coin_transactions WHERE user_id = auth.uid()$q$);
CALL public.expect_fail('security: client cannot call apply_coin_transaction',
  $q$SELECT public.apply_coin_transaction(auth.uid(), 'grant', 50, 'client-grant-0001')$q$);
CALL public.expect_fail('security: client cannot call credit_coins_from_purchase',
  $q$SELECT public.credit_coins_from_purchase(auth.uid(), 50, 'CLIENT-ORDER-0001')$q$);
CALL public.expect_fail('security: client cannot call extend_call_coverage',
  $q$SELECT public.extend_call_coverage(gen_random_uuid(), auth.uid())$q$);
CALL public.expect_fail('security: client cannot call billing_setting_int',
  $q$SELECT public.billing_setting_int('call_free_seconds', 60, 10, 3600)$q$);
CALL public.expect_fail('security: ledger idempotency keys are hidden from clients',
  $q$SELECT idempotency_key FROM public.coin_transactions$q$);
CALL public.expect_fail('security: ledger metadata is hidden from clients',
  $q$SELECT metadata FROM public.coin_transactions$q$);
INSERT INTO public.t_json SELECT 'wallet_a', public.get_my_wallet();
INSERT INTO public.t_results
SELECT 'RLS: owner reads own wallet row and ledger',
  (SELECT balance FROM public.coin_wallets) = 100
    AND (SELECT count(*) FROM public.coin_wallets) = 1
    AND (SELECT sum(amount) FROM public.coin_transactions) = 100,
  'own rows';
RESET ROLE;
INSERT INTO public.t_results
SELECT 'wallet: get_my_wallet reports the credited balance',
  (result->>'balance')::bigint = 100, result::text
FROM public.t_json WHERE label = 'wallet_a';

SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000f';
INSERT INTO public.t_results
SELECT 'RLS: another user sees no wallet rows', count(*) = 0, count(*)::text FROM public.coin_wallets;
INSERT INTO public.t_results
SELECT 'RLS: another user sees no ledger rows', count(*) = 0, count(*)::text FROM public.coin_transactions;
RESET ROLE;

-- ================= B. Ledger integrity =================
CALL public.expect_fail('ledger: UPDATE is blocked even for the table owner',
  $q$UPDATE public.coin_transactions SET amount = amount + 1$q$);
CALL public.expect_fail('ledger: DELETE is blocked even for the table owner',
  $q$DELETE FROM public.coin_transactions$q$);
CALL public.expect_fail('ledger: TRUNCATE is blocked even for the table owner',
  $q$TRUNCATE public.coin_transactions$q$);
CALL public.expect_fail('ledger: call_charge must be negative',
  $q$SELECT public.apply_coin_transaction('70000000-0000-0000-0000-00000000000a', 'call_charge', 5, 'owner-charge-pos', gen_random_uuid())$q$);
CALL public.expect_fail('ledger: purchase must be positive',
  $q$SELECT public.apply_coin_transaction('70000000-0000-0000-0000-00000000000a', 'purchase', -5, 'owner-purch-neg')$q$);
CALL public.expect_fail('ledger: a call charge must reference a call',
  $q$SELECT public.apply_coin_transaction('70000000-0000-0000-0000-00000000000a', 'call_charge', -5, 'owner-charge-nocall')$q$);
CALL public.expect_fail('ledger: unknown transaction kind rejected',
  $q$SELECT public.apply_coin_transaction('70000000-0000-0000-0000-00000000000a', 'bonus', 5, 'owner-unknown-kind')$q$);
CALL public.expect_fail('ledger: too-short idempotency key rejected',
  $q$SELECT public.apply_coin_transaction('70000000-0000-0000-0000-00000000000a', 'grant', 5, 'abc')$q$);
CALL public.expect_fail('ledger: non-object metadata rejected',
  $q$SELECT public.apply_coin_transaction('70000000-0000-0000-0000-00000000000a', 'grant', 5, 'owner-bad-meta-1', NULL, '[1]'::jsonb)$q$);
CALL public.expect_fail('wallet: a balance can never be set negative',
  $q$UPDATE public.coin_wallets SET balance = -1 WHERE user_id = '70000000-0000-0000-0000-00000000000a'$q$);

-- Overspend is refused with no side effects.
INSERT INTO public.t_json SELECT 'overspend',
  public.apply_coin_transaction('70000000-0000-0000-0000-00000000000a', 'adjustment', -101, 'owner-overspend-1');
INSERT INTO public.t_results
SELECT 'wallet: a debit larger than the balance is refused without changing anything',
  NOT (result->>'ok')::boolean AND result->>'code' = 'insufficient_coins'
    AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 100
    AND NOT EXISTS (SELECT 1 FROM public.coin_transactions WHERE idempotency_key = 'owner-overspend-1'),
  result::text
FROM public.t_json WHERE label = 'overspend';
-- Spending exactly the balance is allowed and lands on zero; replaying that debit does not go negative.
INSERT INTO public.t_json SELECT 'spend_all',
  public.apply_coin_transaction('70000000-0000-0000-0000-00000000000a', 'adjustment', -100, 'owner-spendall-1');
INSERT INTO public.t_json SELECT 'spend_all_replay',
  public.apply_coin_transaction('70000000-0000-0000-0000-00000000000a', 'adjustment', -100, 'owner-spendall-1');
INSERT INTO public.t_results
SELECT 'wallet: spending exactly the balance reaches zero and a replay does not go negative',
  (a.result->>'ok')::boolean AND (a.result->>'balance')::bigint = 0
    AND (b.result->>'ok')::boolean AND NOT (b.result->>'applied')::boolean
    AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 0,
  b.result::text
FROM public.t_json a, public.t_json b WHERE a.label = 'spend_all' AND b.label = 'spend_all_replay';

-- Wallet balance ceiling.
INSERT INTO auth.users(id, email) VALUES ('70000000-0000-0000-0000-0000000000f2', 'coin-cap@x');
INSERT INTO public.coin_wallets(user_id, balance) VALUES ('70000000-0000-0000-0000-0000000000f2', 999999990000);
CALL public.expect_fail('wallet: balance ceiling is enforced',
  $q$SELECT public.apply_coin_transaction('70000000-0000-0000-0000-0000000000f2', 'grant', 100000000, 'owner-cap-test-1')$q$);
DELETE FROM auth.users WHERE id = '70000000-0000-0000-0000-0000000000f2';

-- Account deletion cascade is the only permitted ledger delete.
SELECT public.apply_coin_transaction('70000000-0000-0000-0000-0000000000f1', 'grant', 30, 'owner-cascade-0001');
INSERT INTO public.t_results
SELECT 'account deletion: wallet and ledger exist before deleting the user',
  EXISTS (SELECT 1 FROM public.coin_wallets WHERE user_id = '70000000-0000-0000-0000-0000000000f1')
    AND EXISTS (SELECT 1 FROM public.coin_transactions WHERE user_id = '70000000-0000-0000-0000-0000000000f1'),
  'present';
DELETE FROM auth.users WHERE id = '70000000-0000-0000-0000-0000000000f1';
INSERT INTO public.t_results
SELECT 'account deletion: deleting the auth user removes wallet and ledger via cascade',
  NOT EXISTS (SELECT 1 FROM public.coin_wallets WHERE user_id = '70000000-0000-0000-0000-0000000000f1')
    AND NOT EXISTS (SELECT 1 FROM public.coin_transactions WHERE user_id = '70000000-0000-0000-0000-0000000000f1'),
  'removed';

-- ================= C. Call billing: free caller =================
-- Free caller A (no coins) starts a VIDEO call with B. Accept sets the free window and snapshots the rate.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'free_video',
  (public.create_video_call('dddddddd-0000-0000-0000-0000000000a1', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'free_video'), 'accept');
RESET ROLE;

INSERT INTO public.t_results
SELECT 'billing: a free caller gets a 60-second free window, not exempt, rate snapshotted',
  NOT billing_exempt AND billing_rate_coins = 10 AND billing_free_seconds = 60
    AND free_call_until BETWEEN now() + interval '55 seconds' AND now() + interval '61 seconds',
  free_call_until::text
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'free_video');

SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
INSERT INTO public.t_json SELECT 'ext_early',
  public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'free_video'), '70000000-0000-0000-0000-00000000000a');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'billing: no charge while more than the lead time remains',
  (result->>'ok')::boolean AND NOT (result->>'extended')::boolean
    AND (SELECT count(*) FROM public.coin_transactions WHERE kind = 'call_charge'
         AND call_id = (SELECT id FROM public.t_calls WHERE label = 'free_video')) = 0,
  result::text
FROM public.t_json WHERE label = 'ext_early';

-- 50s in: 10s of the free window remain. A has no coins, so the next minute cannot be bought.
SELECT public.t_shift('free_video', 50);
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
INSERT INTO public.t_json SELECT 'ext_broke',
  public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'free_video'), '70000000-0000-0000-0000-00000000000a');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'billing: no coins means no extension, no ledger row and no negative balance',
  NOT (result->>'ok')::boolean AND result->>'code' = 'insufficient_coins'
    AND (result->>'covered_seconds_remaining')::int BETWEEN 1 AND 10
    AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 0
    AND (SELECT billed_minutes FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'free_video')) = 0,
  result::text
FROM public.t_json WHERE label = 'ext_broke';

-- Fund A with 25 coins, then extend: one video minute costs 10.
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.credit_coins_from_purchase('70000000-0000-0000-0000-00000000000a', 25, 'ORDER-TEST-0010');
INSERT INTO public.t_json SELECT 'ext_paid',
  public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'free_video'), '70000000-0000-0000-0000-00000000000a');
-- Immediate repeat from the OTHER participant must not charge again.
INSERT INTO public.t_json SELECT 'ext_repeat',
  public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'free_video'), '70000000-0000-0000-0000-00000000000b');
-- Strangers learn nothing and are never billed.
INSERT INTO public.t_json SELECT 'ext_stranger',
  public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'free_video'), '70000000-0000-0000-0000-00000000000f');
INSERT INTO public.t_json SELECT 'ext_unknown_call',
  public.extend_call_coverage(gen_random_uuid(), '70000000-0000-0000-0000-00000000000a');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'billing: extension charges the CALLER exactly one video minute (10 coins)',
  (result->>'ok')::boolean AND (result->>'extended')::boolean AND (result->>'coins_charged')::int = 10
    AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 15
    AND (SELECT billed_minutes FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'free_video')) = 1
    AND (SELECT coins_charged FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'free_video')) = 10,
  result::text
FROM public.t_json WHERE label = 'ext_paid';
INSERT INTO public.t_results
SELECT 'billing: coverage grew by one minute (about 70s remain)',
  free_call_until BETWEEN now() + interval '65 seconds' AND now() + interval '71 seconds',
  free_call_until::text
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'free_video');
INSERT INTO public.t_results
SELECT 'billing: the recipient triggering a repeat extension does not charge again or bill the recipient',
  (result->>'ok')::boolean AND NOT (result->>'extended')::boolean
    AND NOT EXISTS (SELECT 1 FROM public.coin_wallets WHERE user_id = '70000000-0000-0000-0000-00000000000b')
    AND (SELECT count(*) FROM public.coin_transactions WHERE kind = 'call_charge'
         AND call_id = (SELECT id FROM public.t_calls WHERE label = 'free_video')) = 1,
  result::text
FROM public.t_json WHERE label = 'ext_repeat';
INSERT INTO public.t_results
SELECT 'billing: a non-participant gets call_not_found and no billing effect',
  result->>'code' = 'call_not_found' AND NOT (result->>'ok')::boolean
    AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 15,
  result::text
FROM public.t_json WHERE label = 'ext_stranger';
INSERT INTO public.t_results
SELECT 'billing: an unknown call id is call_not_found',
  result->>'code' = 'call_not_found', result::text
FROM public.t_json WHERE label = 'ext_unknown_call';

-- Join context exposes server facts, never client-supplied time.
INSERT INTO public.t_results
SELECT 'join context: authorised seconds, exempt flag and lead time are server-computed',
  (c->>'free_seconds_remaining')::int BETWEEN 60 AND 71 AND (c->>'billing_exempt')::boolean = false
    AND (c->>'extension_lead_seconds')::int = 20,
  c::text
FROM (SELECT public.get_call_join_context(
  (SELECT id FROM public.t_calls WHERE label = 'free_video'), '70000000-0000-0000-0000-00000000000a') AS c) q;

-- Clients cannot touch the metering columns or read the payer's spending.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
CALL public.expect_fail('security: client cannot extend its own free window',
  $q$UPDATE public.video_calls SET free_call_until = now() + interval '1 day' WHERE caller_id = auth.uid()$q$);
CALL public.expect_fail('security: client cannot mark a call as exempt',
  $q$UPDATE public.video_calls SET billing_exempt = true WHERE caller_id = auth.uid()$q$);
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
CALL public.expect_fail('privacy: the recipient cannot read how many coins the caller spent',
  $q$SELECT coins_charged FROM public.video_calls$q$);
CALL public.expect_fail('privacy: the recipient cannot read billing flags',
  $q$SELECT billing_exempt FROM public.video_calls$q$);
RESET ROLE;

-- Ending right away: the prepaid minute never started, so it is refunded and duration is server-derived.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'free_video'), 'end');
RESET ROLE;
-- 50s simulated + a moment real: duration ~50s, within the free minute, so everything is refunded.
INSERT INTO public.t_results
SELECT 'settlement: a call that ends inside the free minute is refunded in full',
  c.status = 'ended' AND c.settled_at IS NOT NULL AND c.duration_seconds BETWEEN 49 AND 56
    AND c.billed_minutes = 0 AND c.coins_charged = 0
    AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 25
    AND EXISTS (SELECT 1 FROM public.coin_transactions t
                WHERE t.kind = 'refund' AND t.amount = 10 AND t.call_id = c.id
                  AND t.idempotency_key = 'call:' || c.id::text || ':settle'),
  c.duration_seconds::text || 's, balance ' || public.t_balance('70000000-0000-0000-0000-00000000000a')::text
FROM public.video_calls c WHERE c.id = (SELECT id FROM public.t_calls WHERE label = 'free_video');
-- Re-writing an ended call never settles twice.
UPDATE public.video_calls SET ended_at = now()
WHERE id = (SELECT id FROM public.t_calls WHERE label = 'free_video');
INSERT INTO public.t_results
SELECT 'settlement: settling is idempotent (still exactly one refund)',
  (SELECT count(*) FROM public.coin_transactions WHERE kind = 'refund'
   AND call_id = (SELECT id FROM public.t_calls WHERE label = 'free_video')) = 1
  AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 25,
  'one refund';

-- A real two-minute-ish call: A is a free caller on AUDIO (4 coins/min).
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'free_audio',
  (public.create_video_call('dddddddd-0000-0000-0000-0000000000a1', 'audio')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'free_audio'), 'accept');
RESET ROLE;
SELECT public.t_shift('free_audio', 50);   -- t = 50s
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'free_audio'), '70000000-0000-0000-0000-00000000000a');  -- minute 1
RESET ROLE;
SELECT public.t_shift('free_audio', 50);   -- t = 100s, 20s left
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'free_audio'), '70000000-0000-0000-0000-00000000000a');  -- minute 2 (pre-charged)
RESET ROLE;
INSERT INTO public.t_results
SELECT 'billing: two prepaid audio minutes cost 2 x 4 coins',
  public.t_balance('70000000-0000-0000-0000-00000000000a') = 17
    AND (SELECT billed_minutes FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'free_audio')) = 2,
  public.t_balance('70000000-0000-0000-0000-00000000000a')::text;
-- Ends at t ~ 100s: 40s billable -> 1 minute due, the pre-charged second minute is refunded.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'free_audio'), 'end');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'settlement: a 100-second audio call costs exactly one billable minute (4 coins)',
  c.duration_seconds BETWEEN 99 AND 106 AND c.billed_minutes = 1 AND c.coins_charged = 4
    AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 21,
  c.duration_seconds::text || 's, billed ' || c.billed_minutes::text || ', balance ' || public.t_balance('70000000-0000-0000-0000-00000000000a')::text
FROM public.video_calls c WHERE c.id = (SELECT id FROM public.t_calls WHERE label = 'free_audio');

-- A call that really runs 130s on audio: 70s billable -> 2 minutes due, both consumed, nothing refunded.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'long_audio',
  (public.create_video_call('dddddddd-0000-0000-0000-0000000000a1', 'audio')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'long_audio'), 'accept');
RESET ROLE;
SELECT public.t_shift('long_audio', 50);
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'long_audio'), '70000000-0000-0000-0000-00000000000a');
RESET ROLE;
SELECT public.t_shift('long_audio', 60);   -- t = 110s, 10s left of minute 1
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'long_audio'), '70000000-0000-0000-0000-00000000000b');
RESET ROLE;
SELECT public.t_shift('long_audio', 20);   -- t = 130s
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'long_audio'), 'end');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'settlement: a 130-second audio call keeps both charged minutes (8 coins), no refund',
  c.duration_seconds BETWEEN 129 AND 136 AND c.billed_minutes = 2 AND c.coins_charged = 8
    AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 13
    AND NOT EXISTS (SELECT 1 FROM public.coin_transactions WHERE kind = 'refund' AND call_id = c.id),
  c.duration_seconds::text || 's, balance ' || public.t_balance('70000000-0000-0000-0000-00000000000a')::text
FROM public.video_calls c WHERE c.id = (SELECT id FROM public.t_calls WHERE label = 'long_audio');

-- Calling and accepting never require coins; an unpaid call simply stops at the end of the free minute.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_calls SELECT 'broke_caller',
  (public.create_video_call('dddddddd-0000-0000-0000-0000000000a1', 'video')->>'call_id')::uuid;
RESET ROLE;
-- B as caller now (B has no wallet at all): A accepts.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'broke_caller'), 'accept');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'billing: a caller with no wallet can place and start a call (first minute is free)',
  status = 'accepted' AND NOT billing_exempt AND free_call_until IS NOT NULL, status
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'broke_caller');
SELECT public.t_shift('broke_caller', 61);   -- free minute used up
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT * FROM public.get_my_video_calls();   -- lazy server-side expiry sweep
RESET ROLE;
INSERT INTO public.t_results
SELECT 'billing: an unpaid call is ended by the server when the free minute ends, with nothing charged',
  c.status = 'ended' AND c.settled_at IS NOT NULL AND c.billed_minutes = 0 AND c.coins_charged = 0
    AND c.duration_seconds BETWEEN 59 AND 61
    AND NOT EXISTS (SELECT 1 FROM public.coin_wallets WHERE user_id = '70000000-0000-0000-0000-00000000000b'),
  c.duration_seconds::text
FROM public.video_calls c WHERE c.id = (SELECT id FROM public.t_calls WHERE label = 'broke_caller');

-- Stale call swept long after its authorised time: duration is capped at what was authorised.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'stale',
  (public.create_video_call('dddddddd-0000-0000-0000-0000000000a1', 'audio')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'stale'), 'accept');
RESET ROLE;
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'stale'), '70000000-0000-0000-0000-00000000000a');
RESET ROLE;
SELECT public.t_shift('stale', 50);
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'stale'), '70000000-0000-0000-0000-00000000000a');   -- minute 1 (4 coins)
RESET ROLE;
SELECT public.t_shift('stale', 3600);   -- nobody ended it for an hour
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
SELECT * FROM public.get_my_video_calls();
RESET ROLE;
INSERT INTO public.t_results
SELECT 'settlement: a forgotten call is never billed or timed beyond the authorised coverage',
  c.status = 'ended' AND c.duration_seconds = 120 AND c.billed_minutes = 1 AND c.coins_charged = 4
    AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 9,
  c.duration_seconds::text || 's, balance ' || public.t_balance('70000000-0000-0000-0000-00000000000a')::text
FROM public.video_calls c WHERE c.id = (SELECT id FROM public.t_calls WHERE label = 'stale');

-- ================= D. Premium exemption =================
-- Premium caller C is exempt: no window, no charge, no ledger rows.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_calls SELECT 'premium_caller',
  (public.create_video_call('dddddddd-0000-0000-0000-0000000000a2', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'premium_caller'), 'accept');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'premium: a premium caller is exempt (unmetered, no rate, no free-window cap)',
  billing_exempt AND free_call_until IS NULL AND billing_rate_coins IS NULL, 'exempt'
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'premium_caller');
SELECT public.t_shift('premium_caller', 900);
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
INSERT INTO public.t_json SELECT 'ext_premium',
  public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'premium_caller'), '70000000-0000-0000-0000-00000000000b');
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000c';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'premium_caller'), 'end');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'premium: a 15-minute call costs nothing and writes no ledger rows',
  (j.result->>'exempt')::boolean AND (j.result->>'ok')::boolean AND NOT (j.result->>'extended')::boolean
    AND c.coins_charged = 0 AND c.billed_minutes = 0 AND c.duration_seconds BETWEEN 899 AND 906
    AND NOT EXISTS (SELECT 1 FROM public.coin_transactions WHERE call_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.coin_wallets WHERE user_id = '70000000-0000-0000-0000-00000000000c'),
  c.duration_seconds::text || 's'
FROM public.video_calls c, public.t_json j
WHERE c.id = (SELECT id FROM public.t_calls WHERE label = 'premium_caller') AND j.label = 'ext_premium';

-- Free caller A with a VIP recipient: the CALLER pays, so A is still billed (documented rule).
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'free_to_vip',
  (public.create_video_call('dddddddd-0000-0000-0000-0000000000a3', 'audio')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000e';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'free_to_vip'), 'accept');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'premium: a free caller is still metered when the recipient is premium (caller pays)',
  NOT billing_exempt AND free_call_until IS NOT NULL, 'metered'
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'free_to_vip');

-- Upgrading mid-call: the next server-side check sees the entitlement and stops billing.
INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at)
VALUES ('70000000-0000-0000-0000-00000000000a', 'plus', 'active', now() + interval '30 days');
SELECT public.t_shift('free_to_vip', 45);
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
INSERT INTO public.t_json SELECT 'ext_upgrade',
  public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'free_to_vip'), '70000000-0000-0000-0000-00000000000a');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'premium: a caller who upgrades mid-call becomes exempt without being charged',
  (j.result->>'exempt')::boolean AND c.billing_exempt AND c.free_call_until IS NULL
    AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 9,
  j.result::text
FROM public.video_calls c, public.t_json j
WHERE c.id = (SELECT id FROM public.t_calls WHERE label = 'free_to_vip') AND j.label = 'ext_upgrade';
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'free_to_vip'), 'end');
RESET ROLE;
-- An expired subscription is not an exemption.
UPDATE public.user_subscriptions SET expires_at = now() - interval '1 day'
WHERE user_id = '70000000-0000-0000-0000-00000000000a';
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'expired_sub',
  (public.create_video_call('dddddddd-0000-0000-0000-0000000000a1', 'audio')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'expired_sub'), 'accept');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'premium: an expired subscription gives no exemption',
  NOT billing_exempt AND free_call_until IS NOT NULL, 'metered'
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'expired_sub');
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'expired_sub'), 'end');
RESET ROLE;

-- ================= E. Configuration =================
-- Rates are snapshotted at accept: changing settings mid-call does not reprice it.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'snapshot',
  (public.create_video_call('dddddddd-0000-0000-0000-0000000000a1', 'audio')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'snapshot'), 'accept');
RESET ROLE;
UPDATE public.app_settings SET value = '9'::jsonb WHERE key = 'call_rate_audio_coins_per_minute';
SELECT public.t_shift('snapshot', 45);
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.extend_call_coverage((SELECT id FROM public.t_calls WHERE label = 'snapshot'), '70000000-0000-0000-0000-00000000000a');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'config: an in-flight call keeps the rate it started with (4, not the new 9)',
  c.coins_charged = 4 AND public.t_balance('70000000-0000-0000-0000-00000000000a') = 5,
  c.coins_charged::text
FROM public.video_calls c WHERE c.id = (SELECT id FROM public.t_calls WHERE label = 'snapshot');
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'snapshot'), 'end');
RESET ROLE;
-- Fail closed on bad configuration: never charge a wrong or zero rate.
UPDATE public.app_settings SET value = '0'::jsonb WHERE key = 'call_rate_video_coins_per_minute';
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
CALL public.expect_fail('config: a zero call rate is refused (fails closed)', 'SELECT public.get_my_wallet()');
RESET ROLE;
UPDATE public.app_settings SET value = '"ten"'::jsonb WHERE key = 'call_rate_video_coins_per_minute';
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
CALL public.expect_fail('config: a non-numeric call rate is refused', 'SELECT public.get_my_wallet()');
RESET ROLE;
UPDATE public.app_settings SET value = '10'::jsonb WHERE key = 'call_rate_video_coins_per_minute';
UPDATE public.app_settings SET value = '5'::jsonb WHERE key = 'call_free_seconds';
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
CALL public.expect_fail('config: a free window below 10 seconds is refused', 'SELECT public.get_my_wallet()');
RESET ROLE;
UPDATE public.app_settings SET value = '60'::jsonb WHERE key = 'call_free_seconds';
UPDATE public.app_settings SET value = '4'::jsonb WHERE key = 'call_rate_audio_coins_per_minute';

-- ================= F. Global ledger invariants =================
INSERT INTO public.t_results
SELECT 'invariant: every wallet balance equals the sum of its ledger rows',
  NOT EXISTS (
    SELECT 1 FROM public.coin_wallets w
    WHERE w.balance <> (SELECT coalesce(sum(t.amount), 0) FROM public.coin_transactions t WHERE t.user_id = w.user_id)
  ), 'balanced';
INSERT INTO public.t_results
SELECT 'invariant: balance_after tracks the running total for every user',
  NOT EXISTS (
    SELECT 1 FROM (
      SELECT balance_after,
             sum(amount) OVER (PARTITION BY user_id ORDER BY created_at, id) AS running
      FROM public.coin_transactions
    ) s WHERE s.balance_after <> s.running
  ), 'running totals';
INSERT INTO public.t_results
SELECT 'invariant: no wallet is negative',
  NOT EXISTS (SELECT 1 FROM public.coin_wallets WHERE balance < 0), 'non-negative';
INSERT INTO public.t_results
SELECT 'invariant: per-call coins_charged equals the net of its ledger rows',
  NOT EXISTS (
    SELECT 1 FROM public.video_calls c
    WHERE c.settled_at IS NOT NULL AND NOT c.billing_exempt
      AND c.coins_charged <> -coalesce((SELECT sum(t.amount) FROM public.coin_transactions t WHERE t.call_id = c.id), 0)
  ), 'reconciled';
INSERT INTO public.t_results
SELECT 'invariant: every ended accepted call is settled',
  NOT EXISTS (SELECT 1 FROM public.video_calls
              WHERE status = 'ended' AND accepted_at IS NOT NULL AND settled_at IS NULL
                AND id IN (SELECT id FROM public.t_calls)), 'settled';
