\set ON_ERROR_STOP on
-- 53_account_deletion.sql: Step 5 account deletion / retention (migration *_account_deletion_hardening.sql).
-- Covers: pending state, purge idempotency (single audit row), cross-user isolation, location/push/consent/legal/coin
-- cleanup, retained records (reports, payment orders, anonymised audit), orphaned chat-media finder, and that only
-- service_role can run the deletion functions.
-- Fixtures: X (deleted), Y (counterpart, must survive intact), Z (bystander, must survive intact).
INSERT INTO auth.users (id, email) VALUES
 ('b3000000-0000-0000-0000-000000000001', 'dx@x'),
 ('b3000000-0000-0000-0000-000000000002', 'dy@x'),
 ('b3000000-0000-0000-0000-000000000003', 'dz@x');
CALL public.test_complete_profile('b3000000-0000-0000-0000-000000000001', 'Xan', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('b3000000-0000-0000-0000-000000000002', 'Yas', '1995-01-01', 'woman', 'man');
CALL public.test_complete_profile('b3000000-0000-0000-0000-000000000003', 'Zed', '1995-01-01', 'woman', 'man');

INSERT INTO public.matches (id, user_a, user_b) VALUES
 ('b3100000-0000-0000-0000-000000000012', 'b3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000002'),
 ('b3100000-0000-0000-0000-000000000023', 'b3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000003');
INSERT INTO public.messages (match_id, sender, body) VALUES
 ('b3100000-0000-0000-0000-000000000012', 'b3000000-0000-0000-0000-000000000001', 'from X'),
 ('b3100000-0000-0000-0000-000000000012', 'b3000000-0000-0000-0000-000000000002', 'from Y to X'),
 ('b3100000-0000-0000-0000-000000000023', 'b3000000-0000-0000-0000-000000000002', 'Y to Z');
INSERT INTO storage.objects (bucket_id, name) VALUES
 ('chat', 'b3100000-0000-0000-0000-000000000012/m1.jpg'),
 ('chat', 'b3100000-0000-0000-0000-000000000023/m2.jpg');

-- X: consent, location, push token, legal acceptance, coins, order, reports ----------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b3000000-0000-0000-0000-000000000001';
SELECT public.accept_current_legal_documents('2026-10-18', '2026-10-18');
SELECT public.set_my_consent('location_discovery', '2026-10-18', 'granted');
SELECT public.set_my_consent('push_notifications', '2026-10-18', 'granted');
SELECT public.set_my_discovery_location(18.52, 73.86, 10);
SELECT public.register_push_device('ExponentPushToken[b3000000-aaaa-bbbb-cccc-000000000001]', 'android', '1.0.0');
RESET ROLE;
SELECT public.credit_coins_from_purchase('b3000000-0000-0000-0000-000000000001', 100, 'deletion-test-coins-x1');
INSERT INTO public.subscription_orders (user_id, store, order_id, product_id, token_hash, tier, amount_inr, expires_at)
VALUES ('b3000000-0000-0000-0000-000000000001', 'google_play', 'GPA.DEL-0001', 'chahat_premium_1m', 'del-token-hash-1', 'premium', 199, now() + interval '30 days');
INSERT INTO public.reports (reporter, target, category, note) VALUES
 ('b3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000001', 'test', 'Y reports X'),
 ('b3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000003', 'test', 'X reports Z');

-- Y: own consent + coins that must be untouched ---------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b3000000-0000-0000-0000-000000000002';
SELECT public.set_my_consent('location_discovery', '2026-10-18', 'granted');
RESET ROLE;
SELECT public.credit_coins_from_purchase('b3000000-0000-0000-0000-000000000002', 50, 'deletion-test-coins-y1');

INSERT INTO public.t_results
SELECT 'delete: fixtures present before deletion',
  (SELECT count(*) FROM public.discovery_locations WHERE user_id = 'b3000000-0000-0000-0000-000000000001') = 1
  AND (SELECT count(*) FROM public.push_devices WHERE user_id = 'b3000000-0000-0000-0000-000000000001') = 1
  AND (SELECT count(*) FROM public.consent_records WHERE user_id = 'b3000000-0000-0000-0000-000000000001') = 2
  AND (SELECT count(*) FROM public.legal_acceptances WHERE user_id = 'b3000000-0000-0000-0000-000000000001') >= 1
  AND (SELECT balance FROM public.coin_wallets WHERE user_id = 'b3000000-0000-0000-0000-000000000001') = 100, 'fixture counts';

-- Authorization: deletion functions are service_role only ------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b3000000-0000-0000-0000-000000000002';
CALL public.expect_fail('delete: authenticated Y cannot purge X', $q$SELECT public.purge_user_data('b3000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_fail('delete: authenticated Y cannot begin deletion of X', $q$SELECT public.begin_account_deletion('b3000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_fail('delete: authenticated cannot list orphaned chat folders', $q$SELECT * FROM public.find_orphaned_chat_folders()$q$);
RESET ROLE;
SET ROLE anon;
CALL public.expect_fail('delete: anon cannot purge', $q$SELECT public.purge_user_data('b3000000-0000-0000-0000-000000000001')$q$);
RESET ROLE;
INSERT INTO public.t_results
SELECT 'delete: rejected calls changed nothing',
  EXISTS (SELECT 1 FROM public.profiles WHERE id = 'b3000000-0000-0000-0000-000000000001' AND status = 'active'), 'X still active';

-- Pending state (account_state_guard only accepts deletion state from the service role) -----------------------------
SET request.jwt.claim.role = 'service_role';
SELECT public.begin_account_deletion('b3000000-0000-0000-0000-000000000001');
INSERT INTO public.t_results
SELECT 'delete: begin suspends profile, flags pending, removes push tokens',
  (SELECT status FROM public.profiles WHERE id = 'b3000000-0000-0000-0000-000000000001') = 'suspended'
  AND (SELECT (data ->> 'deletionPending') FROM public.account_state WHERE user_id = 'b3000000-0000-0000-0000-000000000001') = 'true'
  AND (SELECT count(*) FROM public.push_devices WHERE user_id = 'b3000000-0000-0000-0000-000000000001') = 0, 'pending state';
SELECT public.begin_account_deletion('b3000000-0000-0000-0000-000000000001');
RESET request.jwt.claim.role;
INSERT INTO public.t_results VALUES ('delete: begin is repeatable', true, 'ok');

-- Purge twice (retry) then the Auth user (what the Edge Function does last) ---------------------------------------
SELECT public.purge_user_data('b3000000-0000-0000-0000-000000000001');
SELECT public.purge_user_data('b3000000-0000-0000-0000-000000000001');
DELETE FROM auth.users WHERE id = 'b3000000-0000-0000-0000-000000000001';
SELECT public.purge_user_data('b3000000-0000-0000-0000-000000000001');
INSERT INTO public.t_results VALUES ('delete: purge after auth deletion still ok (late retry)', true, 'ok');

INSERT INTO public.t_results
SELECT 'delete: X profile, account state, matches and chat messages are gone',
  NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = 'b3000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.account_state WHERE user_id = 'b3000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.matches WHERE 'b3000000-0000-0000-0000-000000000001' IN (user_a, user_b))
  AND NOT EXISTS (SELECT 1 FROM public.messages WHERE match_id = 'b3100000-0000-0000-0000-000000000012'), 'rows removed';
INSERT INTO public.t_results
SELECT 'delete: location, push token, consent, legal acceptance, coins are gone',
  NOT EXISTS (SELECT 1 FROM public.discovery_locations WHERE user_id = 'b3000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.discovery_location_settings WHERE user_id = 'b3000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.push_devices WHERE user_id = 'b3000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.consent_records WHERE user_id = 'b3000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.legal_acceptances WHERE user_id = 'b3000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.coin_wallets WHERE user_id = 'b3000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.coin_transactions WHERE user_id = 'b3000000-0000-0000-0000-000000000001'), 'all cleaned';

-- Cross-user isolation -----------------------------------------------------------------------------------------------
INSERT INTO public.t_results
SELECT 'delete: Y and Z data and their own match survive intact',
  EXISTS (SELECT 1 FROM public.profiles WHERE id = 'b3000000-0000-0000-0000-000000000002')
  AND EXISTS (SELECT 1 FROM public.profiles WHERE id = 'b3000000-0000-0000-0000-000000000003')
  AND EXISTS (SELECT 1 FROM public.matches WHERE id = 'b3100000-0000-0000-0000-000000000023')
  AND (SELECT count(*) FROM public.messages WHERE match_id = 'b3100000-0000-0000-0000-000000000023') = 1
  AND EXISTS (SELECT 1 FROM public.consent_records WHERE user_id = 'b3000000-0000-0000-0000-000000000002')
  AND (SELECT balance FROM public.coin_wallets WHERE user_id = 'b3000000-0000-0000-0000-000000000002') = 50, 'Y/Z intact';

-- Retained records, de-linked -------------------------------------------------------------------------------------
INSERT INTO public.t_results
SELECT 'retain: payment order kept without user link',
  (SELECT count(*) FROM public.subscription_orders WHERE token_hash = 'del-token-hash-1' AND user_id IS NULL AND amount_inr = 199) = 1, 'order retained, user_id NULL';
INSERT INTO public.t_results
SELECT 'retain: reports kept with deleted identifiers; the other party is untouched',
  (SELECT count(*) FROM public.reports WHERE target = 'deleted:' || md5('b3000000-0000-0000-0000-000000000001')
        AND reporter = 'b3000000-0000-0000-0000-000000000002') = 1
  AND (SELECT count(*) FROM public.reports WHERE reporter = 'deleted:' || md5('b3000000-0000-0000-0000-000000000001')
        AND target = 'b3000000-0000-0000-0000-000000000003') = 1
  AND NOT EXISTS (SELECT 1 FROM public.reports WHERE 'b3000000-0000-0000-0000-000000000001' IN (reporter, target)), 'reports de-linked';
INSERT INTO public.t_results
SELECT 'retain: exactly one anonymised audit row after repeated purges',
  (SELECT count(*) FROM public.admin_audit WHERE action = 'account_self_deleted'
     AND target = 'deleted:' || md5('b3000000-0000-0000-0000-000000000001')) = 1
  AND NOT EXISTS (SELECT 1 FROM public.admin_audit WHERE 'b3000000-0000-0000-0000-000000000001' IN (target, admin_id::text)), 'single audit row';

-- Orphaned chat media finder (read-only) --------------------------------------------------------------------------
INSERT INTO public.t_results
SELECT 'orphans: finder lists the deleted match folder, not the live one',
  EXISTS (SELECT 1 FROM public.find_orphaned_chat_folders() WHERE folder = 'b3100000-0000-0000-0000-000000000012' AND object_count = 1)
  AND NOT EXISTS (SELECT 1 FROM public.find_orphaned_chat_folders() WHERE folder = 'b3100000-0000-0000-0000-000000000023'), 'orphan listing';
INSERT INTO public.t_results
SELECT 'orphans: finder is read-only (objects still present)',
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'chat' AND name LIKE 'b3100000-%') = 2, 'objects untouched';
