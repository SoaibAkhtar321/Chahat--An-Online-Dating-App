\set ON_ERROR_STOP on
-- Phase 7-9 lifecycle, entitlement, and SQL migration regressions.

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'phase789-1@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'phase789-2@example.test');

INSERT INTO storage.objects (bucket_id, name, owner)
VALUES (
  'photos',
  '00000000-0000-0000-0000-0000000000c1/phase789.jpg',
  '00000000-0000-0000-0000-0000000000c1'
);

UPDATE public.profiles
SET name = 'Phase 789',
    dob = '1995-01-01',
    gender = 'man',
    seeking = 'woman',
    city = 'Pune',
    bio = 'A complete profile for lifecycle regression tests.',
    intents = ARRAY['Friendship'],
    interests = ARRAY['Books', 'Coffee', 'Music'],
    languages = ARRAY['English'],
    photos = '[{"id":"phase789","path":"00000000-0000-0000-0000-0000000000c1/phase789.jpg","thumbPath":"00000000-0000-0000-0000-0000000000c1/phase789.jpg"}]'::jsonb,
    onboarded = true
WHERE id = '00000000-0000-0000-0000-0000000000c1';

-- Earlier suites change this shared setting (10_functional_rls sets 8); pin the precondition.
INSERT INTO public.app_settings (key, value) VALUES ('daily_like_limit', '20'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO public.user_daily_quotas (user_id, ist_date, likes_used)
VALUES (
  '00000000-0000-0000-0000-0000000000c1',
  (timezone('Asia/Kolkata', now()))::date,
  7
)
ON CONFLICT (user_id, ist_date) DO UPDATE SET likes_used = EXCLUDED.likes_used;

INSERT INTO public.user_subscriptions (user_id, tier, status, starts_at, expires_at, auto_renew)
VALUES (
  '00000000-0000-0000-0000-0000000000c1',
  'premium',
  'active',
  now() - interval '1 day',
  now() + interval '1 month',
  true
);
INSERT INTO public.swipes (from_id, to_id, kind)
VALUES (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000c2',
  'pass'
);

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
CALL public.expect_fail(
  'authenticated cannot mark account pending deletion',
  'SELECT public.begin_account_deletion(''00000000-0000-0000-0000-0000000000c1''::uuid)'
);
INSERT INTO public.t_results
SELECT 'daily quota RPC returns authoritative configured limit and remaining',
  public.get_daily_like_quota()->>'daily_limit' = '20'
    AND public.get_daily_like_quota()->>'likes_remaining' = '13',
  public.get_daily_like_quota()::text;
DO $$
DECLARE result jsonb;
BEGIN
  -- Call first, verify in a later statement: a single statement cannot see rows
  -- deleted by a volatile function it is calling.
  result := public.undo_swipe_pass('00000000-0000-0000-0000-0000000000c2');
  INSERT INTO public.t_results
  SELECT 'paid undo-pass RPC removes the pass and reports a boolean success',
    (result->>'success')::boolean
      AND NOT EXISTS (
        SELECT 1 FROM public.swipes
        WHERE from_id = '00000000-0000-0000-0000-0000000000c1'
          AND to_id = '00000000-0000-0000-0000-0000000000c2'
          AND kind = 'pass'
      ),
    result::text;
END $$;
RESET ROLE;

SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
SELECT public.begin_account_deletion('00000000-0000-0000-0000-0000000000c1'::uuid);
INSERT INTO public.t_results
SELECT 'deletion pending suspends profile and marks state',
  (SELECT status = 'suspended' FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000c1')
    AND (SELECT data->>'deletionPending' = 'true' FROM public.account_state WHERE user_id = '00000000-0000-0000-0000-0000000000c1'),
  'service-role pending marker';
SET ROLE authenticated;
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
CALL public.expect_fail(
  'client cannot clear server deletion-pending state',
  'UPDATE public.account_state SET data = ''{}''::jsonb WHERE user_id = auth.uid()'
);
RESET ROLE;
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
INSERT INTO public.reports (reporter, target, category, note)
VALUES (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000c2',
  'safety',
  'phase789 deletion check'
);
INSERT INTO public.subscription_orders (
  user_id, store, order_id, product_id, token_hash, tier, amount_inr, expires_at
) VALUES (
  '00000000-0000-0000-0000-0000000000c1',
  'google_play',
  'GPA.1234-5678-9012-34567',
  'chahat_premium_1m',
  'phase789_purchase_token_hash_0123456789',
  'premium',
  99,
  now() + interval '1 month'
);
SELECT public.purge_user_data('00000000-0000-0000-0000-0000000000c1'::uuid);
RESET ROLE;
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000000c1';

INSERT INTO public.t_results
SELECT 'purge removes profile', count(*) = 0, count(*)::text
FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000c1';
INSERT INTO public.t_results
SELECT 'purge unlinks but retains subscription order evidence',
  count(*) = 1 AND count(*) FILTER (WHERE user_id IS NULL) = 1,
  count(*)::text || ' rows'
FROM public.subscription_orders
WHERE order_id = 'GPA.1234-5678-9012-34567';
INSERT INTO public.t_results
SELECT 'Auth deletion preserves detached subscription order evidence',
  count(*) = 1 AND count(*) FILTER (WHERE user_id IS NULL) = 1,
  count(*)::text || ' rows'
FROM public.subscription_orders
WHERE order_id = 'GPA.1234-5678-9012-34567';
INSERT INTO public.t_results
SELECT 'purge anonymizes retained moderation report identity',
  count(*) = 1,
  count(*)::text
FROM public.reports
WHERE reporter = 'deleted:' || md5('00000000-0000-0000-0000-0000000000c1');
