-- 20260101007000_admin_aggregates.sql
-- Admin panel audit fix (2026-10-30). The admin-api function counted rows by downloading them, but Supabase returns
-- at most 1,000 rows per request, so tier counts, ad views/clicks and 30-day revenue would silently stop growing once
-- the app had more than 1,000 subscribers / ad events / orders. These read-only aggregates do the counting in the
-- database. Service role only (called by admin-api after it has checked the staff role). No table or policy changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_tier_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_object_agg(tier, n), '{}'::jsonb)
  FROM (SELECT s.tier, count(*) AS n FROM public.user_subscriptions s
        WHERE s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > now())
        GROUP BY s.tier) t;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_tier_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tier_counts() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_ad_stats()
RETURNS TABLE (ad_id uuid, impressions bigint, clicks bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.ad_id,
         count(*) FILTER (WHERE e.kind = 'impression'),
         count(*) FILTER (WHERE e.kind = 'click')
  FROM public.ad_events e
  GROUP BY e.ad_id;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_ad_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ad_stats() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_payments_summary(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH since AS (SELECT now() - make_interval(days => least(greatest(coalesce(_days, 30), 1), 366)) AS t)
  SELECT jsonb_build_object(
    'orders', (SELECT count(*) FROM public.subscription_orders o, since WHERE o.created_at >= since.t AND o.store <> 'manual_grant'),
    'revenueInr', (SELECT coalesce(sum(o.amount_inr), 0) FROM public.subscription_orders o, since WHERE o.created_at >= since.t AND o.store <> 'manual_grant'),
    'failedAttempts', (SELECT count(*) FROM public.purchase_attempts a, since WHERE a.outcome = 'failed' AND a.created_at >= since.t),
    'refundsOrRevocations', (SELECT count(*) FROM public.subscription_orders o, since
                             WHERE o.provider_state IN ('REVOKED', 'REFUNDED') AND o.created_at >= since.t)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.admin_payments_summary(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_payments_summary(integer) TO service_role;

COMMIT;
