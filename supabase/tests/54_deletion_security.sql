\set ON_ERROR_STOP on
-- 54_deletion_security.sql: Step 5 / Phase 3 security checks around account deletion.
-- Covers: consent withdrawal vs deletion, privilege matrix of the deletion functions, search_path pinning,
-- tamper-resistance of evidence and ledger tables while the account is alive, spoofing of the deletion state, and
-- cross-user reads/deletes. Fixtures: W (withdraws consent, then is deleted), V (other user, must be unaffected).
INSERT INTO auth.users (id, email) VALUES
 ('b4000000-0000-0000-0000-000000000001', 'sw@x'),
 ('b4000000-0000-0000-0000-000000000002', 'sv@x');
CALL public.test_complete_profile('b4000000-0000-0000-0000-000000000001', 'Wes', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('b4000000-0000-0000-0000-000000000002', 'Val', '1995-01-01', 'woman', 'man');

-- A. Privilege matrix -------------------------------------------------------------------------------------------------
INSERT INTO public.t_results
SELECT 'delsec: only service_role may execute ' || f.sig,
  NOT has_function_privilege('anon', f.sig, 'EXECUTE')
  AND NOT has_function_privilege('authenticated', f.sig, 'EXECUTE')
  AND has_function_privilege('service_role', f.sig, 'EXECUTE'), f.sig
FROM (VALUES
  ('public.purge_user_data(uuid)'),
  ('public.begin_account_deletion(uuid)'),
  ('public.clear_profile_photos_for_deletion(uuid)'),
  ('public.find_orphaned_chat_folders()')
) AS f(sig);

INSERT INTO public.t_results
SELECT 'delsec: deletion functions are SECURITY DEFINER with a pinned search_path',
  bool_and(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')), string_agg(p.proname, ',')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('purge_user_data', 'begin_account_deletion', 'clear_profile_photos_for_deletion', 'find_orphaned_chat_folders');

-- B. Consent withdrawal, then deletion -------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b4000000-0000-0000-0000-000000000001';
SELECT public.set_my_consent('location_discovery', '2026-10-18', 'granted');
SELECT public.set_my_consent('push_notifications', '2026-10-18', 'granted');
SELECT public.set_my_discovery_location(18.52, 73.86, 10);
SELECT public.register_push_device('ExponentPushToken[b4000000-aaaa-bbbb-cccc-000000000001]', 'android', '1.0.0');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'delsec: location and push token exist after consent',
  (SELECT count(*) FROM public.discovery_locations WHERE user_id = 'b4000000-0000-0000-0000-000000000001') = 1
  AND (SELECT count(*) FROM public.push_devices WHERE user_id = 'b4000000-0000-0000-0000-000000000001') = 1, 'present';
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b4000000-0000-0000-0000-000000000001';
SELECT public.set_my_consent('location_discovery', '2026-10-18', 'withdrawn', 'settings_toggle');
SELECT public.set_my_consent('push_notifications', '2026-10-18', 'withdrawn', 'settings_toggle');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'delsec: withdrawal removes location and push tokens while the account stays',
  (SELECT count(*) FROM public.discovery_locations WHERE user_id = 'b4000000-0000-0000-0000-000000000001') = 0
  AND (SELECT count(*) FROM public.push_devices WHERE user_id = 'b4000000-0000-0000-0000-000000000001') = 0
  AND EXISTS (SELECT 1 FROM public.profiles WHERE id = 'b4000000-0000-0000-0000-000000000001'), 'withdrawn';
INSERT INTO public.t_results
SELECT 'delsec: consent evidence (granted + withdrawn events) kept while the account is alive',
  (SELECT count(*) FROM public.consent_records WHERE user_id = 'b4000000-0000-0000-0000-000000000001') = 4, 'four events';

-- C. Evidence and ledger cannot be tampered with by clients while the account is alive ---------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b4000000-0000-0000-0000-000000000001';
SELECT public.accept_current_legal_documents('2026-10-18', '2026-10-18');
CALL public.expect_fail('delsec: client cannot delete own consent evidence', $q$DELETE FROM public.consent_records WHERE user_id = auth.uid()$q$);
CALL public.expect_fail('delsec: client cannot delete own legal acceptance', $q$DELETE FROM public.legal_acceptances WHERE user_id = auth.uid()$q$);
CALL public.expect_fail('delsec: client cannot forge an acceptance row',
  $q$INSERT INTO public.legal_acceptances (user_id, terms_version, privacy_version) VALUES (auth.uid(), '2026-10-18', '2026-10-18')$q$);
CALL public.expect_fail('delsec: client cannot delete ledger or wallet', $q$DELETE FROM public.coin_wallets WHERE user_id = auth.uid()$q$);
CALL public.expect_fail('delsec: client cannot spoof deletionPending on own account state',
  $q$UPDATE public.account_state SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{deletionPending}', 'true'::jsonb, true) WHERE user_id = auth.uid()$q$);
RESET ROLE;

-- D. Cross-user: V cannot read or remove W's records ------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b4000000-0000-0000-0000-000000000002';
INSERT INTO public.t_results
SELECT 'delsec: V cannot read W consent or legal rows',
  (SELECT count(*) FROM public.consent_records WHERE user_id = 'b4000000-0000-0000-0000-000000000001') = 0
  AND (SELECT count(*) FROM public.legal_acceptances WHERE user_id = 'b4000000-0000-0000-0000-000000000001') = 0, 'RLS hides rows';
DO $$ BEGIN
  BEGIN DELETE FROM public.profiles WHERE id = 'b4000000-0000-0000-0000-000000000001'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM public.account_state WHERE user_id = 'b4000000-0000-0000-0000-000000000001'; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO public.t_results
SELECT 'delsec: V could not delete W profile or account state',
  EXISTS (SELECT 1 FROM public.profiles WHERE id = 'b4000000-0000-0000-0000-000000000001')
  AND EXISTS (SELECT 1 FROM public.account_state WHERE user_id = 'b4000000-0000-0000-0000-000000000001'), 'W intact';

-- E. Delete W, V untouched, retry-safe ---------------------------------------------------------------------------------
SELECT public.credit_coins_from_purchase('b4000000-0000-0000-0000-000000000002', 10, 'delsec-coins-v1');
SET request.jwt.claim.role = 'service_role';
SELECT public.begin_account_deletion('b4000000-0000-0000-0000-000000000001');
RESET request.jwt.claim.role;
SELECT public.purge_user_data('b4000000-0000-0000-0000-000000000001');
DELETE FROM auth.users WHERE id = 'b4000000-0000-0000-0000-000000000001';
SELECT public.purge_user_data('b4000000-0000-0000-0000-000000000001');
INSERT INTO public.t_results
SELECT 'delsec: after deletion no W rows remain anywhere checked',
  NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = 'b4000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.consent_records WHERE user_id = 'b4000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.legal_acceptances WHERE user_id = 'b4000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.discovery_locations WHERE user_id = 'b4000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.push_devices WHERE user_id = 'b4000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.notification_preferences WHERE user_id = 'b4000000-0000-0000-0000-000000000001'), 'clean';
INSERT INTO public.t_results
SELECT 'delsec: V (other user) unaffected by W deletion',
  EXISTS (SELECT 1 FROM public.profiles WHERE id = 'b4000000-0000-0000-0000-000000000002' AND status = 'active')
  AND (SELECT balance FROM public.coin_wallets WHERE user_id = 'b4000000-0000-0000-0000-000000000002') = 10, 'V intact';
INSERT INTO public.t_results
SELECT 'delsec: one audit row for W after three purge calls',
  (SELECT count(*) FROM public.admin_audit WHERE action = 'account_self_deleted'
     AND target = 'deleted:' || md5('b4000000-0000-0000-0000-000000000001')) = 1, 'single';
