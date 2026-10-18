\set ON_ERROR_STOP on
-- 52_optional_consents.sql: purpose-specific consent for location discovery and push notifications
-- (migration *_optional_processing_consents.sql). Covers: no backfill, RPC validation, append-only evidence, RLS and
-- privileges, server-side enforcement on discovery_locations / push_devices, withdrawal effects, idempotency,
-- isolation between users and purposes, legacy-data cleanup, and deletion with the account.

-- Fixtures: P (full flow), Q (isolation), R (never decides), L (legacy data without any consent record).
INSERT INTO auth.users (id, email) VALUES
 ('b2000000-0000-0000-0000-000000000001', 'cp@x'),
 ('b2000000-0000-0000-0000-000000000002', 'cq@x'),
 ('b2000000-0000-0000-0000-000000000003', 'cr@x'),
 ('b2000000-0000-0000-0000-000000000004', 'cl@x');
CALL public.test_complete_profile('b2000000-0000-0000-0000-000000000001', 'Pat', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('b2000000-0000-0000-0000-000000000002', 'Quin', '1995-01-01', 'woman', 'man');
CALL public.test_complete_profile('b2000000-0000-0000-0000-000000000003', 'Rae', '1995-01-01', 'woman', 'man');
CALL public.test_complete_profile('b2000000-0000-0000-0000-000000000004', 'Lee', '1995-01-01', 'man', 'woman');

-- 0. Registry and no-backfill ---------------------------------------------------------------------------------------
INSERT INTO public.t_results
SELECT 'consent: registry seeded with current notice versions',
       (SELECT array_agg(purpose || ':' || version ORDER BY purpose) FROM public.consent_notice_versions)
         = ARRAY['location_discovery:2026-10-18', 'push_notifications:2026-10-18'], 'registry rows';

INSERT INTO public.t_results
SELECT 'consent: users without a decision have no consent rows (no backfill)',
       count(*) = 0, count(*)::text || ' rows'
FROM public.consent_records WHERE user_id::text LIKE 'b2000000%';

-- 1. Nothing is granted by default: server-side enforcement without consent ------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b2000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results
SELECT 'consent: get_my_consents shows both purposes undecided',
       count(*) = 2 AND bool_and(decision IS NULL) AND bool_and(current_notice_version = '2026-10-18'), count(*)::text
FROM public.get_my_consents();
CALL public.expect_fail('consent: storing a location without consent is rejected',
  'SELECT public.set_my_discovery_location(18.52, 73.86, 10)');
CALL public.expect_fail('consent: registering a push token without consent is rejected',
  $q$SELECT public.register_push_device('ExponentPushToken[b2000000-aaaa-bbbb-cccc-000000000001]', 'android', '1.0.0')$q$);
RESET ROLE;
INSERT INTO public.t_results
SELECT 'consent: rejected attempts stored nothing',
       (SELECT count(*) FROM public.discovery_locations WHERE user_id::text LIKE 'b2000000%') = 0
       AND (SELECT count(*) FROM public.push_devices WHERE user_id::text LIKE 'b2000000%') = 0, 'no rows';

-- 2. RPC validation --------------------------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b2000000-0000-0000-0000-000000000001';
CALL public.expect_fail('consent: stale notice version cannot be granted',
  $q$SELECT public.set_my_consent('location_discovery', '2020-01-01', 'granted')$q$);
CALL public.expect_fail('consent: unknown purpose rejected',
  $q$SELECT public.set_my_consent('advertising', '2026-10-18', 'granted')$q$);
CALL public.expect_fail('consent: unknown decision rejected',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'maybe')$q$);
CALL public.expect_fail('consent: unknown method rejected',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'granted', 'signup_checkbox')$q$);
RESET ROLE;
SET ROLE anon;
CALL public.expect_fail('consent: anon cannot record consent',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'granted')$q$);
CALL public.expect_fail('consent: anon cannot read consents', 'SELECT * FROM public.get_my_consents()');
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '';
CALL public.expect_fail('consent: RPC requires a user id',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'granted')$q$);
RESET ROLE;
INSERT INTO public.t_results
SELECT 'consent: failed calls recorded nothing', count(*) = 0, count(*)::text
FROM public.consent_records WHERE user_id::text LIKE 'b2000000%';

-- 3. Location: grant -> store -> withdraw -> blocked ---------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b2000000-0000-0000-0000-000000000001';
CALL public.expect_ok('consent: user grants location consent for the current notice',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'granted')$q$);
CALL public.expect_ok('consent: granting again is an idempotent no-op',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'granted')$q$);
CALL public.expect_ok('consent: with consent the location can be stored',
  'SELECT public.set_my_discovery_location(18.52, 73.86, 10)');
INSERT INTO public.t_results SELECT 'consent: location is stored after consent', public.has_my_discovery_location(), 'enabled';
INSERT INTO public.t_results
SELECT 'consent: one granted row with authenticated user, purpose, version, method and server time',
       count(*) = 1 AND bool_and(user_id = 'b2000000-0000-0000-0000-000000000001' AND purpose = 'location_discovery'
         AND notice_version = '2026-10-18' AND decision = 'granted' AND method = 'in_app_notice'
         AND abs(extract(epoch FROM now() - decided_at)) < 60), count(*)::text
FROM public.consent_records;

CALL public.expect_ok('consent: user withdraws location consent',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'withdrawn', 'settings_toggle')$q$);
INSERT INTO public.t_results SELECT 'consent: withdrawal deletes the stored location', NOT public.has_my_discovery_location(), 'cleared';
CALL public.expect_fail('consent: after withdrawal the location cannot be stored again',
  'SELECT public.set_my_discovery_location(18.52, 73.86, 10)');
CALL public.expect_ok('consent: withdrawing again is an idempotent no-op',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'withdrawn', 'settings_toggle')$q$);
INSERT INTO public.t_results
SELECT 'consent: history is granted then withdrawn, no duplicates',
       array_agg(decision ORDER BY seq) = ARRAY['granted', 'withdrawn'], array_to_string(array_agg(decision ORDER BY seq), ',')
FROM public.consent_records;
INSERT INTO public.t_results
SELECT 'consent: get_my_consents reflects the latest decision',
       (SELECT decision FROM public.get_my_consents() WHERE purpose = 'location_discovery') = 'withdrawn'
       AND (SELECT decision FROM public.get_my_consents() WHERE purpose = 'push_notifications') IS NULL, 'latest';
CALL public.expect_ok('consent: user can grant again after withdrawing',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'granted')$q$);
CALL public.expect_ok('consent: location can be stored again after re-grant',
  'SELECT public.set_my_discovery_location(18.52, 73.86, 10)');
RESET ROLE;
INSERT INTO public.t_results
SELECT 'consent: re-grant appended a new row (full history kept)',
       (SELECT count(*) FROM public.consent_records WHERE user_id = 'b2000000-0000-0000-0000-000000000001') = 3, '3 rows';

-- 4. Push: grant -> register -> withdraw -> tokens and pending deliveries removed ----------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b2000000-0000-0000-0000-000000000001';
CALL public.expect_ok('consent: user grants push consent',
  $q$SELECT public.set_my_consent('push_notifications', '2026-10-18', 'granted')$q$);
CALL public.expect_ok('consent: with consent a push token can be registered',
  $q$SELECT public.register_push_device('ExponentPushToken[b2000000-aaaa-bbbb-cccc-000000000001]', 'android', '1.0.0')$q$);
RESET ROLE;
INSERT INTO public.t_results
SELECT 'consent: granting push did not grant location (purposes are independent)',
       NOT public.has_active_consent('b2000000-0000-0000-0000-000000000003', 'location_discovery')
       AND public.has_active_consent('b2000000-0000-0000-0000-000000000001', 'push_notifications')
       AND public.has_active_consent('b2000000-0000-0000-0000-000000000001', 'location_discovery'), 'independent';

-- A pending delivery for that device (fixture inserted as the owner).
INSERT INTO public.notification_outbox (recipient_id, actor_id, category, event_id)
VALUES ('b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000002', 'like', 'consent-test-1');
INSERT INTO public.notification_deliveries (notification_id, device_id)
SELECT o.id, d.id FROM public.notification_outbox o, public.push_devices d
WHERE o.event_id = 'consent-test-1' AND d.user_id = 'b2000000-0000-0000-0000-000000000001';

SET ROLE authenticated;
SET request.jwt.claim.sub = 'b2000000-0000-0000-0000-000000000001';
CALL public.expect_ok('consent: user withdraws push consent',
  $q$SELECT public.set_my_consent('push_notifications', '2026-10-18', 'withdrawn', 'settings_toggle')$q$);
RESET ROLE;
INSERT INTO public.t_results
SELECT 'consent: push withdrawal removes the device token and its pending deliveries',
       (SELECT count(*) FROM public.push_devices WHERE user_id = 'b2000000-0000-0000-0000-000000000001') = 0
       AND (SELECT count(*) FROM public.notification_deliveries nd
            JOIN public.notification_outbox o ON o.id = nd.notification_id WHERE o.event_id = 'consent-test-1') = 0, 'removed';
INSERT INTO public.t_results
SELECT 'consent: push withdrawal leaves the location consent untouched',
       public.has_active_consent('b2000000-0000-0000-0000-000000000001', 'location_discovery')
       AND (SELECT count(*) FROM public.discovery_locations WHERE user_id = 'b2000000-0000-0000-0000-000000000001') = 1, 'location kept';
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b2000000-0000-0000-0000-000000000001';
CALL public.expect_fail('consent: after push withdrawal a token cannot be registered',
  $q$SELECT public.register_push_device('ExponentPushToken[b2000000-aaaa-bbbb-cccc-000000000001]', 'android', '1.0.0')$q$);
RESET ROLE;

-- Dispatcher housekeeping is never blocked: only ACTIVE tokens need consent.
INSERT INTO public.push_devices (user_id, token, platform, active)
VALUES ('b2000000-0000-0000-0000-000000000003', 'ExponentPushToken[b2000000-aaaa-bbbb-cccc-000000000003]', 'android', false);
CALL public.expect_fail('consent: an inactive token cannot be re-activated without consent',
  $q$UPDATE public.push_devices SET active = true WHERE user_id = 'b2000000-0000-0000-0000-000000000003'$q$);
CALL public.expect_ok('consent: an inactive token row can be maintained without consent',
  $q$UPDATE public.push_devices SET last_seen_at = now() WHERE user_id = 'b2000000-0000-0000-0000-000000000003'$q$);
DELETE FROM public.push_devices WHERE user_id = 'b2000000-0000-0000-0000-000000000003';

-- 5. Isolation between users -------------------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b2000000-0000-0000-0000-000000000002';
CALL public.expect_ok('consent: Q grants location consent and stores a location',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'granted')$q$);
CALL public.expect_ok('consent: Q stores a location', 'SELECT public.set_my_discovery_location(19.07, 72.87, 10)');
INSERT INTO public.t_results
SELECT 'consent: a user reads only their own consent rows',
       count(*) = 1 AND bool_and(user_id = 'b2000000-0000-0000-0000-000000000002'), count(*)::text
FROM public.consent_records;
SET request.jwt.claim.sub = 'b2000000-0000-0000-0000-000000000003';
CALL public.expect_ok('consent: R withdrawing without ever granting is a harmless no-op',
  $q$SELECT public.set_my_consent('location_discovery', '2026-10-18', 'withdrawn', 'settings_toggle')$q$);
RESET ROLE;
INSERT INTO public.t_results
SELECT 'consent: another user withdrawing did not affect Q (consent and location intact)',
       public.has_active_consent('b2000000-0000-0000-0000-000000000002', 'location_discovery')
       AND (SELECT count(*) FROM public.discovery_locations WHERE user_id = 'b2000000-0000-0000-0000-000000000002') = 1
       AND (SELECT count(*) FROM public.consent_records WHERE user_id = 'b2000000-0000-0000-0000-000000000003') = 0,
       'isolated';

-- 6. Privileges and append-only evidence -------------------------------------------------------------------------------
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b2000000-0000-0000-0000-000000000002';
CALL public.expect_fail('consent: clients cannot insert consent rows directly',
  $q$INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
     VALUES ('b2000000-0000-0000-0000-000000000002', 'push_notifications', '2026-10-18', 'granted', 'in_app_notice')$q$);
CALL public.expect_fail('consent: clients cannot update consent rows',
  $q$UPDATE public.consent_records SET decision = 'granted'$q$);
CALL public.expect_fail('consent: clients cannot delete consent rows', 'DELETE FROM public.consent_records');
CALL public.expect_fail('consent: clients cannot call the internal consent helper',
  $q$SELECT public.has_active_consent('b2000000-0000-0000-0000-000000000002', 'location_discovery')$q$);
CALL public.expect_fail('consent: clients cannot edit the notice registry',
  $q$INSERT INTO public.consent_notice_versions (purpose, version) VALUES ('location_discovery', '2030-01-01')$q$);
RESET ROLE;
SET ROLE anon;
CALL public.expect_fail('consent: anon cannot read consent rows', 'SELECT * FROM public.consent_records');
RESET ROLE;
CALL public.expect_fail('consent: rows are immutable even for privileged roles',
  $q$UPDATE public.consent_records SET decision = 'withdrawn'$q$);

-- 7. Legacy data without any consent record (what the migration's cleanup statements remove) ------------------------------
ALTER TABLE public.discovery_locations DISABLE TRIGGER discovery_locations_require_consent;
ALTER TABLE public.push_devices DISABLE TRIGGER push_devices_require_consent;
INSERT INTO public.discovery_locations (user_id, latitude, longitude)
VALUES ('b2000000-0000-0000-0000-000000000004', 18.52, 73.86);
INSERT INTO public.push_devices (user_id, token, platform)
VALUES ('b2000000-0000-0000-0000-000000000004', 'ExponentPushToken[b2000000-aaaa-bbbb-cccc-000000000004]', 'android');
ALTER TABLE public.discovery_locations ENABLE TRIGGER discovery_locations_require_consent;
ALTER TABLE public.push_devices ENABLE TRIGGER push_devices_require_consent;

DELETE FROM public.discovery_locations l WHERE NOT public.has_active_consent(l.user_id, 'location_discovery');
DELETE FROM public.push_devices d WHERE NOT public.has_active_consent(d.user_id, 'push_notifications');
INSERT INTO public.t_results
SELECT 'consent: cleanup removes legacy location and token without consent but keeps consented data',
       (SELECT count(*) FROM public.discovery_locations WHERE user_id = 'b2000000-0000-0000-0000-000000000004') = 0
       AND (SELECT count(*) FROM public.push_devices WHERE user_id = 'b2000000-0000-0000-0000-000000000004') = 0
       AND (SELECT count(*) FROM public.discovery_locations WHERE user_id = 'b2000000-0000-0000-0000-000000000002') = 1, 'cleaned';

-- 8. Deletion with the account ------------------------------------------------------------------------------------------
DELETE FROM auth.users WHERE id = 'b2000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results
SELECT 'consent: consent rows are removed when the account is deleted', count(*) = 0, 'user P'
FROM public.consent_records WHERE user_id = 'b2000000-0000-0000-0000-000000000001';
