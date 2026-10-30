\set ON_ERROR_STOP on
-- 20260101007000: admin aggregates are exact (not capped at 1,000 rows) and staff-only.
INSERT INTO public.ads(id, advertiser, title, active) VALUES ('86ad0000-0000-0000-0000-000000000001', 'Agg', 'Agg', true);
INSERT INTO auth.users(id, email) SELECT ('86000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'agg' || g || '@x'
FROM generate_series(1, 1200) g;
INSERT INTO public.ad_events(ad_id, user_id, kind)
SELECT '86ad0000-0000-0000-0000-000000000001', ('86000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'impression'
FROM generate_series(1, 1200) g;
SET ROLE authenticated;
CALL public.expect_fail('admin aggregates: members cannot read ad stats', $q$SELECT * FROM public.admin_ad_stats()$q$);
CALL public.expect_fail('admin aggregates: members cannot read tier counts', $q$SELECT public.admin_tier_counts()$q$);
CALL public.expect_fail('admin aggregates: members cannot read payments', $q$SELECT public.admin_payments_summary(30)$q$);
RESET ROLE;
SET ROLE service_role;
INSERT INTO public.t_json SELECT 'agg_ad', to_jsonb(s) FROM public.admin_ad_stats() s WHERE s.ad_id = '86ad0000-0000-0000-0000-000000000001';
INSERT INTO public.t_json SELECT 'agg_pay', public.admin_payments_summary(30);
INSERT INTO public.t_json SELECT 'agg_tiers', public.admin_tier_counts();
RESET ROLE;
INSERT INTO public.t_results SELECT 'admin aggregates: ad views are counted past 1,000', (result->>'impressions')::int = 1200, result::text
FROM public.t_json WHERE label = 'agg_ad';
INSERT INTO public.t_results SELECT 'admin aggregates: payments and tier summaries return numbers',
  (SELECT result ? 'revenueInr' AND result ? 'failedAttempts' FROM public.t_json WHERE label = 'agg_pay')
  AND (SELECT jsonb_typeof(result) = 'object' FROM public.t_json WHERE label = 'agg_tiers'), 'shape';
