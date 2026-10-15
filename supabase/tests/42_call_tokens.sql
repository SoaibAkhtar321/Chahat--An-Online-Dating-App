\set ON_ERROR_STOP on
-- Phase 3: call-token rate limiting and the server-only join-context function.
-- Reuses the users, matches and calls created by 40_video_calls.sql.

-- Fixtures: a fresh accepted call between users 1 and 3 is not possible while the earlier
-- paid_call is open, so build rows directly as the table owner (tests only).
INSERT INTO auth.users(id, email) VALUES ('61000000-0000-0000-0000-000000000009', 'call-rl@x');

CREATE TEMP TABLE ctx_calls (label text PRIMARY KEY, id uuid);
INSERT INTO ctx_calls
SELECT 'accepted_free', id FROM public.video_calls
WHERE caller_id = '60000000-0000-0000-0000-000000000001'
  AND recipient_id = '60000000-0000-0000-0000-000000000002' LIMIT 1;

UPDATE public.video_calls
SET status = 'accepted', accepted_at = now(), ended_at = NULL,
    free_call_until = now() + interval '45 seconds'
WHERE id = (SELECT id FROM ctx_calls WHERE label = 'accepted_free');

-- 1. Join context for the two participants and for strangers.
INSERT INTO public.t_results
SELECT 'join context: caller sees accepted call',
  (c->>'found')::boolean AND c->>'status' = 'accepted' AND (c->>'eligible')::boolean
    AND (c->>'accepted')::boolean AND c->>'call_type' = 'video',
  c::text
FROM (SELECT public.get_call_join_context(
  (SELECT id FROM ctx_calls WHERE label = 'accepted_free'),
  '60000000-0000-0000-0000-000000000001') AS c) q;

INSERT INTO public.t_results
SELECT 'join context: recipient sees accepted call',
  (c->>'found')::boolean AND c->>'status' = 'accepted',
  c::text
FROM (SELECT public.get_call_join_context(
  (SELECT id FROM ctx_calls WHERE label = 'accepted_free'),
  '60000000-0000-0000-0000-000000000002') AS c) q;

INSERT INTO public.t_results
SELECT 'join context: unrelated user gets found=false and no call data',
  c = jsonb_build_object('found', false), c::text
FROM (SELECT public.get_call_join_context(
  (SELECT id FROM ctx_calls WHERE label = 'accepted_free'),
  '60000000-0000-0000-0000-000000000003') AS c) q;

INSERT INTO public.t_results
SELECT 'join context: unknown call and null user are not found',
  public.get_call_join_context(gen_random_uuid(), '60000000-0000-0000-0000-000000000001')
    = jsonb_build_object('found', false)
  AND public.get_call_join_context((SELECT id FROM ctx_calls), NULL)
    = jsonb_build_object('found', false),
  'unknown';

INSERT INTO public.t_results
SELECT 'join context: free allowance is server-computed and bounded',
  (c->>'free_seconds_remaining')::int BETWEEN 1 AND 45, c->>'free_seconds_remaining'
FROM (SELECT public.get_call_join_context(
  (SELECT id FROM ctx_calls WHERE label = 'accepted_free'),
  '60000000-0000-0000-0000-000000000001') AS c) q;

-- 2. State changes are reflected, never cached.
UPDATE public.video_calls SET free_call_until = now() - interval '1 second'
WHERE id = (SELECT id FROM ctx_calls WHERE label = 'accepted_free');
INSERT INTO public.t_results
SELECT 'join context: elapsed allowance reports 0 seconds',
  (c->>'free_seconds_remaining')::int = 0, c->>'free_seconds_remaining'
FROM (SELECT public.get_call_join_context(
  (SELECT id FROM ctx_calls WHERE label = 'accepted_free'),
  '60000000-0000-0000-0000-000000000001') AS c) q;

UPDATE public.video_calls SET status = 'ended', ended_at = now()
WHERE id = (SELECT id FROM ctx_calls WHERE label = 'accepted_free');
INSERT INTO public.t_results
SELECT 'join context: ended call reports ended',
  c->>'status' = 'ended', c->>'status'
FROM (SELECT public.get_call_join_context(
  (SELECT id FROM ctx_calls WHERE label = 'accepted_free'),
  '60000000-0000-0000-0000-000000000001') AS c) q;

UPDATE public.video_calls SET status = 'pending', accepted_at = NULL, ended_at = NULL
WHERE id = (SELECT id FROM ctx_calls WHERE label = 'accepted_free');
INSERT INTO public.t_results
SELECT 'join context: pending call is not marked accepted',
  c->>'status' = 'pending' AND NOT (c->>'accepted')::boolean, c::text
FROM (SELECT public.get_call_join_context(
  (SELECT id FROM ctx_calls WHERE label = 'accepted_free'),
  '60000000-0000-0000-0000-000000000001') AS c) q;

-- Blocking either participant makes them ineligible.
INSERT INTO public.blocks(blocker, blocked)
VALUES ('60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001');
INSERT INTO public.t_results
SELECT 'join context: blocked pair can no longer join (match removed or ineligible)',
  NOT coalesce((c->>'eligible')::boolean, false), c::text
FROM (SELECT public.get_call_join_context(
  (SELECT id FROM ctx_calls WHERE label = 'accepted_free'),
  '60000000-0000-0000-0000-000000000001') AS c) q;
DELETE FROM public.blocks
WHERE blocker = '60000000-0000-0000-0000-000000000002'
  AND blocked = '60000000-0000-0000-0000-000000000001';

-- 3. Privilege checks: clients can call neither function nor read the limiter table.
SET ROLE authenticated;
SET request.jwt.claim.sub = '60000000-0000-0000-0000-000000000001';
CALL public.expect_fail('authenticated cannot call get_call_join_context',
  $q$SELECT public.get_call_join_context(gen_random_uuid(), '60000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_fail('authenticated cannot call consume_call_token_rate_limit',
  $q$SELECT public.consume_call_token_rate_limit('60000000-0000-0000-0000-000000000001')$q$);
CALL public.expect_fail('authenticated cannot read rate limit rows',
  $q$SELECT count(*) FROM public.call_token_rate_limits$q$);
CALL public.expect_fail('authenticated cannot write rate limit rows',
  $q$INSERT INTO public.call_token_rate_limits VALUES ('60000000-0000-0000-0000-000000000001', now(), 1)$q$);
RESET ROLE;
SET ROLE anon;
CALL public.expect_fail('anon cannot call get_call_join_context',
  $q$SELECT public.get_call_join_context(gen_random_uuid(), gen_random_uuid())$q$);
CALL public.expect_fail('anon cannot call consume_call_token_rate_limit',
  $q$SELECT public.consume_call_token_rate_limit(gen_random_uuid())$q$);
RESET ROLE;

-- 4. Rate limiting (service role only): default 10 per minute, then blocked, per user.
SET ROLE service_role;
CREATE TEMP TABLE rl_results (n int, allowed boolean);
GRANT ALL ON rl_results TO service_role;
INSERT INTO rl_results
SELECT g, (public.consume_call_token_rate_limit('61000000-0000-0000-0000-000000000009')->>'allowed')::boolean
FROM generate_series(1, 12) g;
INSERT INTO public.t_results
SELECT 'rate limit: first 10 requests allowed, 11th and 12th blocked',
  (SELECT count(*) FROM rl_results WHERE allowed) = 10
  AND (SELECT bool_and(NOT allowed) FROM rl_results WHERE n > 10),
  (SELECT count(*) FILTER (WHERE allowed) || ' allowed' FROM rl_results);

INSERT INTO public.t_results
SELECT 'rate limit: blocked response carries a positive retry-after',
  (r->>'retry_after_seconds')::int BETWEEN 1 AND 60, r::text
FROM (SELECT public.consume_call_token_rate_limit('61000000-0000-0000-0000-000000000009') AS r) q;

INSERT INTO public.t_results
SELECT 'rate limit: other users are unaffected',
  (public.consume_call_token_rate_limit('60000000-0000-0000-0000-000000000001')->>'allowed')::boolean,
  'user 1 first request';
RESET ROLE;

INSERT INTO public.t_results
SELECT 'rate limit: counter row is stored per user and window',
  (SELECT count(*) FROM public.call_token_rate_limits
   WHERE user_id = '61000000-0000-0000-0000-000000000009') = 1
  AND (SELECT request_count FROM public.call_token_rate_limits
       WHERE user_id = '61000000-0000-0000-0000-000000000009') = 13,
  'one row, count 13';

-- Limit is configurable server-side without code changes.
UPDATE public.app_settings SET value = '2'::jsonb WHERE key = 'call_token_rate_limit_per_minute';
DELETE FROM public.call_token_rate_limits WHERE user_id = '61000000-0000-0000-0000-000000000009';
SET ROLE service_role;
CREATE TEMP TABLE rl2 (n int, allowed boolean);
GRANT ALL ON rl2 TO service_role;
INSERT INTO rl2
SELECT g, (public.consume_call_token_rate_limit('61000000-0000-0000-0000-000000000009')->>'allowed')::boolean
FROM generate_series(1, 3) g;
RESET ROLE;
INSERT INTO public.t_results
SELECT 'rate limit: app_settings value is honoured',
  (SELECT count(*) FROM rl2 WHERE allowed) = 2 AND (SELECT NOT allowed FROM rl2 WHERE n = 3),
  'limit 2';
UPDATE public.app_settings SET value = '10'::jsonb WHERE key = 'call_token_rate_limit_per_minute';

-- Old windows are pruned for the user on the next request.
INSERT INTO public.call_token_rate_limits VALUES
  ('61000000-0000-0000-0000-000000000009', now() - interval '3 hours', 5);
SELECT public.consume_call_token_rate_limit('61000000-0000-0000-0000-000000000009');
INSERT INTO public.t_results
SELECT 'rate limit: stale windows are pruned',
  NOT EXISTS (SELECT 1 FROM public.call_token_rate_limits
              WHERE user_id = '61000000-0000-0000-0000-000000000009'
                AND window_start < now() - interval '1 hour'),
  'pruned';

-- Deleting the user removes the counters (no orphaned rows).
DELETE FROM auth.users WHERE id = '61000000-0000-0000-0000-000000000009';
INSERT INTO public.t_results
SELECT 'rate limit: rows cascade with the user',
  NOT EXISTS (SELECT 1 FROM public.call_token_rate_limits
              WHERE user_id = '61000000-0000-0000-0000-000000000009'), 'cascaded';
