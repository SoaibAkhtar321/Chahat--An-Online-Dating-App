\set ON_ERROR_STOP on
-- Task Q1: no paid-tier bypass. Premium, VIP and free users all hit the same configured limits.
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000f6','p@x'),('00000000-0000-0000-0000-0000000000f7','f@x'),('00000000-0000-0000-0000-0000000000f8','v@x');
INSERT INTO auth.users(id) SELECT ('30000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid FROM generate_series(1,14) g;
SET request.jwt.claim.role='service_role';
UPDATE public.profiles SET name='u',dob='1995-01-01',city='Pune',gender='man',seeking='woman' WHERE id IN ('00000000-0000-0000-0000-0000000000f6','00000000-0000-0000-0000-0000000000f7','00000000-0000-0000-0000-0000000000f8');
UPDATE public.profiles SET name='t',dob='1996-01-01',city='Pune',gender='woman',seeking='man' WHERE id LIKE '30000000-%';
RESET request.jwt.claim.role;
INSERT INTO public.user_subscriptions(user_id,tier,status,expires_at) VALUES
  ('00000000-0000-0000-0000-0000000000f6','premium','active',now()+interval '30 days'),('00000000-0000-0000-0000-0000000000f8','vip','active',NULL);
-- configured defaults (an earlier test file lowers the like limit to 8)
INSERT INTO public.app_settings(key,value) VALUES ('daily_like_limit','10'),('daily_priority_like_limit','3')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- the premium/vip rows are real, active entitlements (so the old bypass would have applied)
INSERT INTO public.t_results SELECT 'test setup: premium and vip subscriptions are active',
  public.get_active_subscription_tier('00000000-0000-0000-0000-0000000000f6')='premium' AND public.get_active_subscription_tier('00000000-0000-0000-0000-0000000000f8')='vip' AND public.get_active_subscription_tier('00000000-0000-0000-0000-0000000000f7')='free', 'tiers';

SET ROLE authenticated;
DO $$
DECLARE u text; label text; r jsonb; ok int; i int; first_remaining int; prio_ok int;
BEGIN
  FOREACH u IN ARRAY ARRAY['00000000-0000-0000-0000-0000000000f6','00000000-0000-0000-0000-0000000000f8','00000000-0000-0000-0000-0000000000f7'] LOOP
    PERFORM set_config('request.jwt.claim.sub', u, false);
    label := CASE u WHEN '00000000-0000-0000-0000-0000000000f6' THEN 'premium' WHEN '00000000-0000-0000-0000-0000000000f8' THEN 'vip' ELSE 'free' END;
    ok := 0;
    FOR i IN 1..10 LOOP
      r := public.record_swipe('30000000-0000-0000-0000-'||lpad(i::text,12,'0'), 'like');
      IF i = 1 THEN first_remaining := (r->>'likes_remaining')::int; END IF;
      IF (r->>'success')::boolean THEN ok := ok + 1; END IF;
    END LOOP;
    INSERT INTO public.t_results VALUES (label||': first like reports 9 remaining (not 999)', first_remaining = 9, first_remaining::text);
    INSERT INTO public.t_results VALUES (label||': 10 ordinary likes succeed', ok = 10, ok::text);
    r := public.record_swipe('30000000-0000-0000-0000-'||lpad('11',12,'0'), 'like');
    INSERT INTO public.t_results VALUES (label||': 11th ordinary like blocked', NOT (r->>'success')::boolean AND r->>'error'='daily_like_limit_reached' AND (r->>'likes_remaining')::int=0, r::text);
    prio_ok := 0;
    FOR i IN 11..13 LOOP
      r := public.record_swipe('30000000-0000-0000-0000-'||lpad(i::text,12,'0'), 'priority');
      IF (r->>'success')::boolean THEN prio_ok := prio_ok + 1; END IF;
    END LOOP;
    INSERT INTO public.t_results VALUES (label||': 3 priority likes succeed', prio_ok = 3, prio_ok::text);
    r := public.record_swipe('30000000-0000-0000-0000-'||lpad('14',12,'0'), 'priority');
    INSERT INTO public.t_results VALUES (label||': 4th priority like blocked, likes_remaining not 999', NOT (r->>'success')::boolean AND r->>'error'='daily_super_like_limit_reached' AND (r->>'likes_remaining')::int=0, r::text);
    r := public.record_swipe('30000000-0000-0000-0000-'||lpad('14',12,'0'), 'pass');
    INSERT INTO public.t_results VALUES (label||': pass is never quota-limited', (r->>'success')::boolean, r::text);
  END LOOP;
END $$;
RESET ROLE;

INSERT INTO public.t_results SELECT 'quota rows are per user and capped at the limit', bool_and(likes_used <= 10 AND super_likes_used <= 3), string_agg(user_id||':'||likes_used||'/'||super_likes_used, ' ') FROM public.user_daily_quotas WHERE user_id IN ('00000000-0000-0000-0000-0000000000f6','00000000-0000-0000-0000-0000000000f7','00000000-0000-0000-0000-0000000000f8');
