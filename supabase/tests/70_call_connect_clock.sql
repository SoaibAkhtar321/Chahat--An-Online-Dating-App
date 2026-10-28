\set ON_ERROR_STOP on
-- 20260101005500_call_connect_clock_and_history: connect grace at accept, clock restart when both connect,
-- participant-only mark_call_connected. Runs after 43_coin_billing.sql (reuses its fixtures and helpers).
UPDATE public.app_settings SET value = '30'::jsonb WHERE key = 'call_connect_grace_seconds';
UPDATE public.app_settings SET value = '60'::jsonb WHERE key = 'call_free_seconds';

-- Make sure no earlier call between A and B is still live.
UPDATE public.video_calls SET status = 'ended', ended_at = now()
WHERE status IN ('pending', 'accepted')
  AND '70000000-0000-0000-0000-00000000000a' IN (caller_id, recipient_id);

SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_calls SELECT 'connect_clock',
  (public.create_video_call('dddddddd-0000-0000-0000-0000000000a1', 'video')->>'call_id')::uuid;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'connect_clock'), 'accept');
RESET ROLE;

INSERT INTO public.t_results
SELECT 'connect clock: accept adds the 30 s connect grace to the free window',
  extract(epoch FROM (free_call_until - accepted_at)) BETWEEN 85 AND 91,
  extract(epoch FROM (free_call_until - accepted_at))::int::text
FROM public.video_calls WHERE id = (SELECT id FROM public.t_calls WHERE label = 'connect_clock');

-- A stranger cannot mark the call connected.
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000c';
CALL public.expect_fail('connect clock: non-participant cannot mark a call connected',
  $q$SELECT public.mark_call_connected((SELECT id FROM public.t_calls WHERE label = 'connect_clock'))$q$);
RESET ROLE;

SELECT public.t_shift('connect_clock', 20);   -- 20 s spent joining
SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_json SELECT 'cc_one',
  public.mark_call_connected((SELECT id FROM public.t_calls WHERE label = 'connect_clock'));
RESET ROLE;
INSERT INTO public.t_results
SELECT 'connect clock: one side connected does not start the clock',
  (result->>'both_connected')::boolean = false, result::text
FROM public.t_json WHERE label = 'cc_one';

SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_json SELECT 'cc_both',
  public.mark_call_connected((SELECT id FROM public.t_calls WHERE label = 'connect_clock'));
RESET ROLE;
INSERT INTO public.t_results
SELECT 'connect clock: both connected restarts the full 60 s free window',
  (result->>'both_connected')::boolean AND (result->>'seconds_remaining')::int BETWEEN 59 AND 60,
  result::text
FROM public.t_json WHERE label = 'cc_both';

SET ROLE authenticated;
SET request.jwt.claim.sub = '70000000-0000-0000-0000-00000000000a';
SELECT public.transition_video_call((SELECT id FROM public.t_calls WHERE label = 'connect_clock'), 'end');
RESET ROLE;
