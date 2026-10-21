\set ON_ERROR_STOP on
-- 66_message_delivery.sql: message delivery ticks (migration 20260101004700). Runs after 10_functional_rls.sql
-- (uses public.t_results, expect_fail, expect_ok, test_complete_profile).
-- Fixtures: A, B = members of M1 (A is a free sender, B the recipient); P, B = members of M2 (P has Plus);
-- C = stranger. Rows are seeded as superuser; every client action runs as `authenticated` through RLS and RPCs.

\o /dev/null
CREATE TABLE public.t66(k text PRIMARY KEY, v jsonb);
GRANT ALL ON public.t66 TO PUBLIC;
CREATE OR REPLACE FUNCTION public.t66_check(_name text, _ok boolean, _detail text DEFAULT '') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results VALUES (_name, coalesce(_ok, false), _detail)
$$;

INSERT INTO auth.users(id, email) VALUES
 ('f6600000-0000-0000-0000-000000000001','dl-a@x'), ('f6600000-0000-0000-0000-000000000002','dl-b@x'),
 ('f6600000-0000-0000-0000-000000000003','dl-c@x'), ('f6600000-0000-0000-0000-000000000004','dl-p@x');
CALL public.test_complete_profile('f6600000-0000-0000-0000-000000000001','DlA','1995-01-01','man','woman');
CALL public.test_complete_profile('f6600000-0000-0000-0000-000000000002','DlB','1995-01-01','woman','man');
CALL public.test_complete_profile('f6600000-0000-0000-0000-000000000003','DlC','1995-01-01','man','woman');
CALL public.test_complete_profile('f6600000-0000-0000-0000-000000000004','DlP','1995-01-01','man','woman');
INSERT INTO public.matches(id, user_a, user_b) VALUES
 ('f6660000-0000-4000-8000-000000000001','f6600000-0000-0000-0000-000000000001','f6600000-0000-0000-0000-000000000002'),
 ('f6660000-0000-4000-8000-000000000002','f6600000-0000-0000-0000-000000000002','f6600000-0000-0000-0000-000000000004');
INSERT INTO public.user_subscriptions(user_id, tier, status, expires_at)
VALUES ('f6600000-0000-0000-0000-000000000004', 'plus', 'active', now() + interval '30 days');

-- m1..m3: A -> B in M1; m4: B -> A in M1; m5: P -> B in M2; m6: A -> B in M1 already read before the migration (backfill N/A here)
INSERT INTO public.messages(id, match_id, sender, body, message_type, created_at) VALUES
 ('f6670000-0000-4000-8000-000000000001','f6660000-0000-4000-8000-000000000001','f6600000-0000-0000-0000-000000000001','one','text', now()-interval '50 min'),
 ('f6670000-0000-4000-8000-000000000002','f6660000-0000-4000-8000-000000000001','f6600000-0000-0000-0000-000000000001','two','text', now()-interval '49 min'),
 ('f6670000-0000-4000-8000-000000000003','f6660000-0000-4000-8000-000000000001','f6600000-0000-0000-0000-000000000001','three','text', now()-interval '48 min'),
 ('f6670000-0000-4000-8000-000000000004','f6660000-0000-4000-8000-000000000001','f6600000-0000-0000-0000-000000000002','from B','text', now()-interval '47 min'),
 ('f6670000-0000-4000-8000-000000000005','f6660000-0000-4000-8000-000000000002','f6600000-0000-0000-0000-000000000004','plus one','text', now()-interval '46 min');
\o

-- ===== A. Structure ==============================================================================================
SELECT public.t66_check('dl: messages.delivered_at exists',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' AND column_name='delivered_at'));
SELECT public.t66_check('dl: exactly one get_match_messages overload and one mark_messages_delivered',
  (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='get_match_messages') = 1
  AND (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='mark_messages_delivered') = 1);
SELECT public.t66_check('dl: new messages start undelivered and unread',
  (SELECT count(*) FROM public.messages WHERE id::text LIKE 'f6670000%' AND (delivered_at IS NOT NULL OR read_at IS NOT NULL)) = 0);

-- ===== B. Who may call the RPC ===================================================================================
SET ROLE anon;
CALL public.expect_fail('dl: anon cannot call mark_messages_delivered', $q$SELECT public.mark_messages_delivered(NULL)$q$);
RESET ROLE;

-- stranger C: nothing of M1/M2 is touched
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000003'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t66 SELECT 'c_count', to_jsonb(public.mark_messages_delivered(NULL));
INSERT INTO public.t66 SELECT 'c_count_m1', to_jsonb(public.mark_messages_delivered('f6660000-0000-4000-8000-000000000001'));
RESET ROLE;
SELECT public.t66_check('dl: a stranger marks nothing delivered',
  (SELECT (v)::int FROM public.t66 WHERE k='c_count') = 0 AND (SELECT (v)::int FROM public.t66 WHERE k='c_count_m1') = 0
  AND (SELECT count(*) FROM public.messages WHERE delivered_at IS NOT NULL AND id::text LIKE 'f6670000%') = 0);

-- sender A cannot deliver own messages (m1-m3) or write delivered_at directly; A is the RECIPIENT of m4, so only m4 is marked
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t66 SELECT 'a_count', to_jsonb(public.mark_messages_delivered('f6660000-0000-4000-8000-000000000001'));
UPDATE public.messages SET delivered_at = now() WHERE id = 'f6670000-0000-4000-8000-000000000001';
RESET ROLE;
SELECT public.t66_check('dl: the sender cannot mark own messages delivered (RPC or direct UPDATE); only A''s incoming m4 is marked',
  (SELECT (v)::int FROM public.t66 WHERE k='a_count') = 1
  AND (SELECT count(*) FROM public.messages WHERE id IN ('f6670000-0000-4000-8000-000000000001','f6670000-0000-4000-8000-000000000002','f6670000-0000-4000-8000-000000000003') AND delivered_at IS NOT NULL) = 0
  AND (SELECT delivered_at IS NOT NULL FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000004'));
INSERT INTO public.t66 SELECT 'm4_ts', to_jsonb(delivered_at::text) FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000004';

-- ===== C. Recipient B marks one match delivered ==================================================================
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t66 SELECT 'b_count_m1', to_jsonb(public.mark_messages_delivered('f6660000-0000-4000-8000-000000000001'));
RESET ROLE;
SELECT public.t66_check('dl: recipient marks exactly the 3 incoming messages of that match delivered',
  (SELECT (v)::int FROM public.t66 WHERE k='b_count_m1') = 3
  AND (SELECT count(*) FROM public.messages WHERE id IN ('f6670000-0000-4000-8000-000000000001','f6670000-0000-4000-8000-000000000002','f6670000-0000-4000-8000-000000000003') AND delivered_at IS NOT NULL) = 3);
SELECT public.t66_check('dl: B''s own message and the other match are untouched by a per-match call',
  (SELECT delivered_at::text FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000004') = (SELECT v #>> '{}' FROM public.t66 WHERE k='m4_ts')
  AND (SELECT delivered_at IS NULL FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000005'));
INSERT INTO public.t66 SELECT 'first_ts', to_jsonb(delivered_at::text) FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000001';

-- calling again is a no-op and delivered_at is write-once
SELECT pg_sleep(0.05);
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t66 SELECT 'b_count_again', to_jsonb(public.mark_messages_delivered('f6660000-0000-4000-8000-000000000001'));
UPDATE public.messages SET delivered_at = now() WHERE id = 'f6670000-0000-4000-8000-000000000001';
UPDATE public.messages SET delivered_at = NULL WHERE id = 'f6670000-0000-4000-8000-000000000002';
RESET ROLE;
SELECT public.t66_check('dl: second call marks nothing; delivered_at cannot be changed or cleared by a client',
  (SELECT (v)::int FROM public.t66 WHERE k='b_count_again') = 0
  AND (SELECT delivered_at::text FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000001') = (SELECT v #>> '{}' FROM public.t66 WHERE k='first_ts')
  AND (SELECT delivered_at IS NOT NULL FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000002'));

-- NULL = every match of the caller
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t66 SELECT 'b_count_all', to_jsonb(public.mark_messages_delivered(NULL));
RESET ROLE;
SELECT public.t66_check('dl: NULL match id covers all of the caller''s matches (the Plus sender message in M2)',
  (SELECT (v)::int FROM public.t66 WHERE k='b_count_all') = 1
  AND (SELECT delivered_at IS NOT NULL FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000005'));

-- ===== D. Read implies delivered; server clock wins ===============================================================
-- A fresh message that is read without ever being marked delivered
INSERT INTO public.messages(id, match_id, sender, body, message_type) VALUES
 ('f6670000-0000-4000-8000-000000000006','f6660000-0000-4000-8000-000000000001','f6600000-0000-0000-0000-000000000001','read directly','text');
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
UPDATE public.messages SET read_at = '2001-01-01T00:00:00Z' WHERE id = 'f6670000-0000-4000-8000-000000000006';
RESET ROLE;
SELECT public.t66_check('dl: reading a message also sets delivered_at, stamped by the server clock',
  (SELECT delivered_at IS NOT NULL AND delivered_at > now() - interval '1 hour' FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000006'));

-- a client-supplied delivered_at in the past is replaced by the server time
INSERT INTO public.messages(id, match_id, sender, body, message_type) VALUES
 ('f6670000-0000-4000-8000-000000000007','f6660000-0000-4000-8000-000000000001','f6600000-0000-0000-0000-000000000001','client clock','text');
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
UPDATE public.messages SET delivered_at = '2001-01-01T00:00:00Z' WHERE id = 'f6670000-0000-4000-8000-000000000007';
RESET ROLE;
SELECT public.t66_check('dl: a client cannot back-date or forge delivered_at',
  (SELECT delivered_at > now() - interval '1 hour' FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000007'));

-- ===== E. get_match_messages: delivered visible to everyone, read masked for free senders (unchanged) ==============
-- Make M1's m2 read by B (recipient) so A (free) has something to be masked.
UPDATE public.messages SET read_at = now() WHERE id = 'f6670000-0000-4000-8000-000000000002';
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t66 SELECT 'a_rpc', coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at), '[]') FROM public.get_match_messages('f6660000-0000-4000-8000-000000000001', 100) r;
RESET ROLE;
SELECT public.t66_check('dl: free sender sees delivered_at but read_at stays masked',
  (SELECT bool_and(e->>'delivered_at' IS NOT NULL) FROM jsonb_array_elements((SELECT v FROM public.t66 WHERE k='a_rpc')) e WHERE e->>'sender' = 'f6600000-0000-0000-0000-000000000001' AND e->>'id' IN ('f6670000-0000-4000-8000-000000000001','f6670000-0000-4000-8000-000000000002','f6670000-0000-4000-8000-000000000003'))
  AND (SELECT bool_and(e->>'read_at' IS NULL) FROM jsonb_array_elements((SELECT v FROM public.t66 WHERE k='a_rpc')) e WHERE e->>'sender' = 'f6600000-0000-0000-0000-000000000001'));

-- Plus sender P: mark M2 read by B, then P sees the read receipt
UPDATE public.messages SET read_at = now() WHERE id = 'f6670000-0000-4000-8000-000000000005';
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000004'; SET request.jwt.claim.role = 'authenticated';
INSERT INTO public.t66 SELECT 'p_rpc', coalesce(jsonb_agg(to_jsonb(r)), '[]') FROM public.get_match_messages('f6660000-0000-4000-8000-000000000002', 100) r;
RESET ROLE;
SELECT public.t66_check('dl: Plus sender sees both delivered_at and read_at',
  (SELECT e->>'delivered_at' IS NOT NULL AND e->>'read_at' IS NOT NULL FROM jsonb_array_elements((SELECT v FROM public.t66 WHERE k='p_rpc')) e LIMIT 1));

-- A stranger still cannot read the thread
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000003'; SET request.jwt.claim.role = 'authenticated';
CALL public.expect_fail('dl: a stranger cannot call get_match_messages for M1', $q$SELECT * FROM public.get_match_messages('f6660000-0000-4000-8000-000000000001', 10)$q$);
RESET ROLE;

-- ===== F. Tombstones are never marked ================================================================================
INSERT INTO public.messages(id, match_id, sender, body, message_type) VALUES
 ('f6670000-0000-4000-8000-000000000008','f6660000-0000-4000-8000-000000000001','f6600000-0000-0000-0000-000000000001','to be deleted','text');
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000001'; SET request.jwt.claim.role = 'authenticated';
SELECT public.delete_message_for_everyone('f6670000-0000-4000-8000-000000000008');
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub = 'f6600000-0000-0000-0000-000000000002'; SET request.jwt.claim.role = 'authenticated';
SELECT public.mark_messages_delivered('f6660000-0000-4000-8000-000000000001');
RESET ROLE;
SELECT public.t66_check('dl: a message deleted for everyone is not marked delivered',
  (SELECT delivered_at IS NULL AND deleted_at IS NOT NULL FROM public.messages WHERE id='f6670000-0000-4000-8000-000000000008'));
