\set ON_ERROR_STOP on
-- 20260101006900: suspension blocks messages, ads (targeting, events, no member access to tables), announcement
-- targets honour the opt-out, purchase_attempts / metrics are staff only.
INSERT INTO auth.users(id, email) VALUES
  ('85000000-0000-0000-0000-00000000000a', 'ac-a@x'),
  ('85000000-0000-0000-0000-00000000000b', 'ac-b@x');
CALL public.test_complete_profile('85000000-0000-0000-0000-00000000000a', 'ACA', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('85000000-0000-0000-0000-00000000000b', 'ACB', '1996-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('85aaaaaa-0000-0000-0000-0000000000a1', '85000000-0000-0000-0000-00000000000a', '85000000-0000-0000-0000-00000000000b');

-- Suspension
SET request.jwt.claim.role = 'service_role';  -- what admin-api uses
UPDATE public.profiles SET status = 'suspended' WHERE id = '85000000-0000-0000-0000-00000000000a';
RESET request.jwt.claim.role;
SET ROLE authenticated; SET request.jwt.claim.sub = '85000000-0000-0000-0000-00000000000a';
CALL public.expect_fail('suspension: a suspended member cannot send messages',
  $q$INSERT INTO public.messages(match_id, sender, body) VALUES ('85aaaaaa-0000-0000-0000-0000000000a1', '85000000-0000-0000-0000-00000000000a', 'hi')$q$);
INSERT INTO public.t_json SELECT 'ac_status', public.get_my_account_status();
RESET ROLE;
INSERT INTO public.t_results SELECT 'suspension: the app learns the account is suspended', result->>'status' = 'suspended', result::text
FROM public.t_json WHERE label = 'ac_status';
SET request.jwt.claim.role = 'service_role';
UPDATE public.profiles SET status = 'active' WHERE id = '85000000-0000-0000-0000-00000000000a';
RESET request.jwt.claim.role;
SET ROLE authenticated; SET request.jwt.claim.sub = '85000000-0000-0000-0000-00000000000a';
INSERT INTO public.messages(match_id, sender, body) VALUES ('85aaaaaa-0000-0000-0000-0000000000a1', '85000000-0000-0000-0000-00000000000a', 'hi again');
RESET ROLE;
INSERT INTO public.t_results SELECT 'suspension: restored members can message again', count(*) = 1, count(*)::text
FROM public.messages WHERE match_id = '85aaaaaa-0000-0000-0000-0000000000a1';

-- Ads
INSERT INTO public.ads(id, advertiser, title, active, target_gender) VALUES
  ('85ad0000-0000-0000-0000-000000000001', 'Acme', 'For men', true, 'man'),
  ('85ad0000-0000-0000-0000-000000000002', 'Acme', 'Paused', false, ''),
  ('85ad0000-0000-0000-0000-000000000003', 'Acme', 'Ended', true, '');
UPDATE public.ads SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' WHERE id = '85ad0000-0000-0000-0000-000000000003';
SET ROLE authenticated; SET request.jwt.claim.sub = '85000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_json SELECT 'ads_man', coalesce(jsonb_agg(a.title), '[]') FROM public.get_discover_ads(5) a;
SELECT public.record_ad_event('85ad0000-0000-0000-0000-000000000001', 'impression');
SELECT public.record_ad_event('85ad0000-0000-0000-0000-000000000001', 'impression');
SELECT public.record_ad_event('85ad0000-0000-0000-0000-000000000001', 'click');
CALL public.expect_fail('ads: members cannot read the ads table directly', $q$SELECT * FROM public.ads$q$);
CALL public.expect_fail('ads: members cannot write ad events directly',
  $q$INSERT INTO public.ad_events(ad_id, user_id, kind) VALUES ('85ad0000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-00000000000a', 'click')$q$);
CALL public.expect_fail('ads: members cannot read purchase attempts', $q$SELECT * FROM public.purchase_attempts$q$);
CALL public.expect_fail('reports: members cannot run business metrics', $q$SELECT * FROM public.admin_daily_metrics(current_date, current_date)$q$);
CALL public.expect_fail('broadcast: members cannot list push targets', $q$SELECT * FROM public.announcement_targets('{}'::jsonb)$q$);
SET request.jwt.claim.sub = '85000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_json SELECT 'ads_woman', coalesce(jsonb_agg(a.title), '[]') FROM public.get_discover_ads(5) a;
RESET ROLE;
INSERT INTO public.t_results SELECT 'ads: only live ads for the member''s gender are shown (paused / ended hidden)',
  (SELECT result FROM public.t_json WHERE label = 'ads_man') = '["For men"]'::jsonb
  AND (SELECT result FROM public.t_json WHERE label = 'ads_woman') = '[]'::jsonb, 'targeting';
INSERT INTO public.t_results SELECT 'ads: one impression and one click per member per day',
  count(*) = 2, count(*)::text FROM public.ad_events WHERE ad_id = '85ad0000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'ads: bucket is public, images only, 1 MB',
  public AND file_size_limit = 1048576 AND NOT ('image/gif' = ANY (allowed_mime_types)), 'bucket'
FROM storage.buckets WHERE id = 'ads';
CALL public.expect_fail('ads: image path outside creatives/ is refused',
  $q$INSERT INTO public.ads(advertiser, title, image_path) VALUES ('x', 'y', '../profiles/secret.jpg')$q$);

-- Announcements honour the opt-out
INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
SELECT id, 'push_notifications', '2026-10-18', 'granted', 'in_app_notice'
FROM auth.users WHERE id IN ('85000000-0000-0000-0000-00000000000a', '85000000-0000-0000-0000-00000000000b');
INSERT INTO public.push_devices(user_id, token, platform, active) VALUES
  ('85000000-0000-0000-0000-00000000000a', 'ExponentPushToken[ac-a-123456789]', 'android', true),
  ('85000000-0000-0000-0000-00000000000b', 'ExponentPushToken[ac-b-123456789]', 'android', true);
INSERT INTO public.notification_preferences(user_id, updates) VALUES ('85000000-0000-0000-0000-00000000000b', false)
ON CONFLICT (user_id) DO UPDATE SET updates = false;
SET ROLE service_role;
INSERT INTO public.t_json SELECT 'ann_all', coalesce(jsonb_agg(t.push_token), '[]') FROM public.announcement_targets('{}'::jsonb, NULL, 1000) t
WHERE t.push_token LIKE 'ExponentPushToken[ac-%';
INSERT INTO public.t_json SELECT 'ann_women', coalesce(jsonb_agg(t.push_token), '[]') FROM public.announcement_targets('{"gender":"woman"}'::jsonb, NULL, 1000) t
WHERE t.push_token LIKE 'ExponentPushToken[ac-%';
INSERT INTO public.t_json SELECT 'metrics', to_jsonb(m) FROM public.admin_daily_metrics(current_date, current_date) m;
RESET ROLE;
INSERT INTO public.t_results SELECT 'broadcast: members who turned off offers are never targeted',
  (SELECT result FROM public.t_json WHERE label = 'ann_all') = '["ExponentPushToken[ac-a-123456789]"]'::jsonb
  AND (SELECT result FROM public.t_json WHERE label = 'ann_women') = '[]'::jsonb, 'opt-out';
INSERT INTO public.t_results SELECT 'reports: daily metrics count today''s matches, messages and ad clicks',
  (result->>'matches')::int >= 1 AND (result->>'messages')::int >= 1 AND (result->>'ad_clicks')::int >= 1, result::text
FROM public.t_json WHERE label = 'metrics';
