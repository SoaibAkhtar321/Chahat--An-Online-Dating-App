\set ON_ERROR_STOP on
-- 63_feed_block_antijoin.sql: the discovery feed's block check is a set-based anti-join on public.blocks
-- (migration 20260101004400) and keeps the meaning of public.is_blocked_pair(): a block in EITHER direction
-- between the caller and a candidate hides the candidate; blocks between two OTHER members change nothing.
-- Viewer V (man seeking woman, Pune). Candidates (women, Pune): 11 plain, 12 blocked BY V, 13 HAS blocked V,
-- 14 blocked by a third party T only (must stay visible). T (02) is a man, so never a candidate himself.
INSERT INTO auth.users(id, email)
SELECT ('63000000-0000-0000-0000-0000000000' || n)::uuid, 'antijoin' || n || '@x'
FROM unnest(ARRAY['01','02','11','12','13','14']) AS n;

CALL public.test_complete_profile('63000000-0000-0000-0000-000000000001', 'Viewer V', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('63000000-0000-0000-0000-000000000002', 'Third T', '1995-01-01', 'man', 'woman');
DO $$
DECLARE n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['11','12','13','14'] LOOP
    CALL public.test_complete_profile(('63000000-0000-0000-0000-0000000000' || n)::uuid, 'Cand ' || n,
      '1996-01-01', 'woman', 'man');
  END LOOP;
END $$;

INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
SELECT id, 'location_discovery', '2026-10-18', 'granted', 'in_app_notice'
FROM auth.users WHERE id::text LIKE '63000000%';

INSERT INTO public.blocks (blocker, blocked) VALUES
  ('63000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000012'),  -- V blocked 12
  ('63000000-0000-0000-0000-000000000013', '63000000-0000-0000-0000-000000000001'),  -- 13 blocked V
  ('63000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000014');  -- T blocked 14 (not V)

-- Every feed call below uses the page cursor (distance 0, id just before 63000000...) so the page starts at this
-- test's own members; other suites' fixtures share the database and sort ahead of them (limit is capped at 50).
SET ROLE authenticated; SET request.jwt.claim.sub = '63000000-0000-0000-0000-000000000001';
INSERT INTO public.t_results SELECT 'p5b feed: a candidate the viewer blocked is hidden',
  NOT EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 99, 150, '{}', '{}', '{}', 0, '62ffffff-ffff-ffff-ffff-ffffffffffff')
              WHERE id = '63000000-0000-0000-0000-000000000012'), 'blocked by viewer';
INSERT INTO public.t_results SELECT 'p5b feed: a candidate who blocked the viewer is hidden (reverse direction)',
  NOT EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 99, 150, '{}', '{}', '{}', 0, '62ffffff-ffff-ffff-ffff-ffffffffffff')
              WHERE id = '63000000-0000-0000-0000-000000000013'), 'blocked viewer';
INSERT INTO public.t_results SELECT 'p5b feed: a block between two other members does not hide the candidate',
  EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 99, 150, '{}', '{}', '{}', 0, '62ffffff-ffff-ffff-ffff-ffffffffffff')
          WHERE id = '63000000-0000-0000-0000-000000000014'), 'third-party block';
INSERT INTO public.t_results SELECT 'p5b feed: an unblocked candidate is visible',
  EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 99, 150, '{}', '{}', '{}', 0, '62ffffff-ffff-ffff-ffff-ffffffffffff')
          WHERE id = '63000000-0000-0000-0000-000000000011'), 'plain';
-- Equivalence with the previous predicate: for every candidate of this test, visible <=> NOT is_blocked_pair().
INSERT INTO public.t_results
SELECT 'p5b feed: visibility equals NOT is_blocked_pair() for every candidate',
  count(*) = 4 AND bool_and(visible = NOT public.is_blocked_pair('63000000-0000-0000-0000-000000000001', cid)),
  string_agg(right(cid, 2) || '=' || visible::text, ',' ORDER BY cid)
FROM (
  -- candidate ids are listed explicitly: RLS correctly hides blocked members' profile rows from the viewer
  SELECT c.cid,
         EXISTS (SELECT 1 FROM public.get_discovery_feed_page(50, 18, 99, 150, '{}', '{}', '{}', 0, '62ffffff-ffff-ffff-ffff-ffffffffffff') f
                 WHERE f.id = c.cid) AS visible
  FROM (SELECT '63000000-0000-0000-0000-0000000000' || n AS cid FROM unnest(ARRAY['11','12','13','14']) AS n) c
) x;
RESET ROLE;

SET ROLE anon;
CALL public.expect_fail('p5b feed: anon still cannot call the feed',
  $q$SELECT * FROM public.get_discovery_feed_page(10, 18, 50, 100, '{}', '{}', '{}', NULL, NULL)$q$);
RESET ROLE;

-- Structure: no per-row function call remains, the blocks table is read directly, one overload, still hardened.
INSERT INTO public.t_results SELECT 'p5b feed: the feed no longer calls is_blocked_pair per row',
  pg_get_functiondef(p.oid) NOT LIKE '%public.is_blocked_pair(%' AND pg_get_functiondef(p.oid) LIKE '%public.blocks b%',
  'definition'
  FROM pg_proc p WHERE p.proname = 'get_discovery_feed_page' AND p.pronamespace = 'public'::regnamespace;
INSERT INTO public.t_results SELECT 'p5b feed: exactly one overload, SECURITY DEFINER with a pinned search_path',
  count(*) = 1 AND bool_and(prosecdef) AND bool_and(proconfig::text LIKE '%search_path%'), count(*)::text
  FROM pg_proc WHERE proname = 'get_discovery_feed_page' AND pronamespace = 'public'::regnamespace;
INSERT INTO public.t_results SELECT 'p5b feed: grants unchanged (authenticated yes, anon and PUBLIC no)',
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
  AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'), 'grants'
  FROM pg_proc p WHERE p.proname = 'get_discovery_feed_page' AND p.pronamespace = 'public'::regnamespace;
