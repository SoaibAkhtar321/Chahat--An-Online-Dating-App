\set ON_ERROR_STOP on
-- 20260101006800: photos bucket 2 MB, growth indexes, export_my_data (own data only).
INSERT INTO auth.users(id, email) VALUES
  ('84000000-0000-0000-0000-00000000000a', 'ex-a@x'),
  ('84000000-0000-0000-0000-00000000000b', 'ex-b@x');
CALL public.test_complete_profile('84000000-0000-0000-0000-00000000000a', 'EXA', '1995-01-01', 'man', 'woman');
CALL public.test_complete_profile('84000000-0000-0000-0000-00000000000b', 'EXB', '1996-01-01', 'woman', 'man');
INSERT INTO public.matches(id, user_a, user_b) VALUES
  ('84aaaaaa-0000-0000-0000-0000000000a1', '84000000-0000-0000-0000-00000000000a', '84000000-0000-0000-0000-00000000000b');
INSERT INTO public.messages(match_id, sender, body) VALUES
  ('84aaaaaa-0000-0000-0000-0000000000a1', '84000000-0000-0000-0000-00000000000a', 'hello from A'),
  ('84aaaaaa-0000-0000-0000-0000000000a1', '84000000-0000-0000-0000-00000000000b', 'secret reply from B');

INSERT INTO public.t_results SELECT 'storage: photos bucket accepts at most 2 MB, chat keeps 5 MB',
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'photos') = 2097152
  AND (SELECT file_size_limit FROM storage.buckets WHERE id = 'chat') = 5242880, 'limits';
INSERT INTO public.t_results SELECT 'indexes: growth indexes exist',
  count(*) = 6, string_agg(indexname, ',') FROM pg_indexes
WHERE schemaname = 'public' AND indexname IN ('video_calls_match_idx', 'video_calls_pending_expiry_idx',
  'video_calls_accepted_idx', 'call_events_call_idx', 'message_reactions_user_idx', 'reports_reporter_idx');

SET ROLE anon;
CALL public.expect_fail('export: anon cannot export', $q$SELECT public.export_my_data()$q$);
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = '84000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_json SELECT 'ex_a', public.export_my_data();
RESET ROLE;
INSERT INTO public.t_results SELECT 'export: own profile, email, match and own messages are included',
  result->'profile'->>'name' = 'EXA' AND result->'account'->>'email' = 'ex-a@x'
  AND jsonb_array_length(result->'matches') = 1
  AND result->'messages_sent'->0->>'text' = 'hello from A', left(result::text, 200)
FROM public.t_json WHERE label = 'ex_a';
INSERT INTO public.t_results SELECT 'export: the other member''s messages and private data are not included',
  position('secret reply from B' IN result::text) = 0 AND position('ex-b@x' IN result::text) = 0
  AND jsonb_array_length(result->'messages_sent') = 1, 'no leak'
FROM public.t_json WHERE label = 'ex_a';
INSERT INTO public.t_results SELECT 'export: no push or purchase tokens',
  position('token' IN coalesce(result->>'devices', '')) = 0 AND NOT (result->'subscription' ? 'source_order_id'), 'no tokens'
FROM public.t_json WHERE label = 'ex_a';
