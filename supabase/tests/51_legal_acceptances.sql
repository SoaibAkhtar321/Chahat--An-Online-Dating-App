\set ON_ERROR_STOP on
-- 51_legal_acceptances.sql: Terms/Privacy acceptance evidence (migration *_legal_acceptances.sql).
-- Covers: no backfill, confirmation-time recording from signup metadata, forged/unknown claims, RLS and privileges,
-- re-acceptance RPC, immutability, and deletion with the account.

-- 0. Users that existed before/independent of this feature have NO acceptance rows (no backfill).
INSERT INTO public.t_results
SELECT 'legal: pre-existing users are not backfilled',
       (SELECT count(*) FROM auth.users) > 0 AND (SELECT count(*) FROM public.legal_acceptances) = 0,
       (SELECT count(*) FROM auth.users) || ' users, ' || (SELECT count(*) FROM public.legal_acceptances) || ' acceptance rows';

INSERT INTO public.t_results
SELECT 'legal: registry seeded with current versions',
       (SELECT array_agg(document || ':' || version ORDER BY document) FROM public.legal_document_versions)
         = ARRAY['privacy:2026-10-18','terms:2026-10-18'], 'registry rows';

-- Fixtures (inserted as the migration owner, as the real Auth service would).
-- A: auto-confirmed with a valid claim; B: unconfirmed with a valid claim; C: unconfirmed, no claim;
-- D: unknown terms version; E: valid terms, unknown privacy version; F: claim is not an object; G: confirmed, no claim.
INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at) VALUES
 ('a1000000-0000-0000-0000-00000000000a','la@x','{"legal_acceptance":{"terms_version":"2026-10-18","privacy_version":"2026-10-18"}}', now(), now() - interval '2 hours'),
 ('a1000000-0000-0000-0000-00000000000b','lb@x','{"legal_acceptance":{"terms_version":"2026-10-18","privacy_version":"2026-10-18"}}', NULL, now() - interval '3 hours'),
 ('a1000000-0000-0000-0000-00000000000c','lc@x','{}', NULL, now()),
 ('a1000000-0000-0000-0000-00000000000d','ld@x','{"legal_acceptance":{"terms_version":"1999-01-01","privacy_version":"2026-10-18"}}', now(), now()),
 ('a1000000-0000-0000-0000-00000000000e','le@x','{"legal_acceptance":{"terms_version":"2026-10-18","privacy_version":"2030-01-01"}}', now(), now()),
 ('a1000000-0000-0000-0000-00000000000f','lf@x','{"legal_acceptance":"yes"}', now(), now()),
 ('a1000000-0000-0000-0000-000000000010','lg@x',NULL, now(), now());

INSERT INTO public.t_results
SELECT 'legal: auto-confirmed signup with valid claim recorded (method, versions, accepted_at = signup time)',
       count(*) = 1 AND bool_and(method = 'signup_checkbox' AND terms_version = '2026-10-18' AND privacy_version = '2026-10-18'
         AND accepted_at < now() - interval '1 hour 59 minutes' AND accepted_at <= recorded_at), 'user A'
FROM public.legal_acceptances WHERE user_id = 'a1000000-0000-0000-0000-00000000000a';

INSERT INTO public.t_results
SELECT 'legal: unconfirmed signup records nothing',
       count(*) = 0, 'user B before confirmation'
FROM public.legal_acceptances WHERE user_id = 'a1000000-0000-0000-0000-00000000000b';

UPDATE auth.users SET email_confirmed_at = now() WHERE id IN
 ('a1000000-0000-0000-0000-00000000000b','a1000000-0000-0000-0000-00000000000c');

INSERT INTO public.t_results
SELECT 'legal: confirmation records the signup choice with the SIGNUP time, not the confirmation time',
       count(*) = 1 AND bool_and(accepted_at < now() - interval '2 hours 59 minutes' AND method = 'signup_checkbox'), 'user B after confirmation'
FROM public.legal_acceptances WHERE user_id = 'a1000000-0000-0000-0000-00000000000b';

-- re-confirming / changing the confirmation timestamp must not create a second row
UPDATE auth.users SET email_confirmed_at = now() + interval '1 minute' WHERE id = 'a1000000-0000-0000-0000-00000000000b';
INSERT INTO public.t_results
SELECT 'legal: later email_confirmed_at changes do not duplicate evidence',
       count(*) = 1, 'user B'
FROM public.legal_acceptances WHERE user_id = 'a1000000-0000-0000-0000-00000000000b';

INSERT INTO public.t_results
SELECT 'legal: no claim / unknown version / malformed claim record nothing',
       count(*) = 0, 'users C,D,E,F,G'
FROM public.legal_acceptances WHERE user_id IN (
 'a1000000-0000-0000-0000-00000000000c','a1000000-0000-0000-0000-00000000000d','a1000000-0000-0000-0000-00000000000e',
 'a1000000-0000-0000-0000-00000000000f','a1000000-0000-0000-0000-000000000010');

-- anon: no evidence, no writes, registry readable, no RPC
SET ROLE anon;
CALL public.expect_fail('legal: anon cannot read acceptances','SELECT * FROM public.legal_acceptances');
CALL public.expect_fail('legal: anon cannot insert acceptances','INSERT INTO public.legal_acceptances(user_id,terms_version,privacy_version,accepted_at,method) VALUES (''a1000000-0000-0000-0000-00000000000c'',''2026-10-18'',''2026-10-18'',now(),''signup_checkbox'')');
CALL public.expect_ok('legal: anon can read the public version registry','SELECT * FROM public.legal_document_versions');
CALL public.expect_fail('legal: anon cannot write the registry','INSERT INTO public.legal_document_versions(document,version) VALUES (''terms'',''2030-01-01'')');
CALL public.expect_fail('legal: anon cannot call accept RPC','SELECT public.accept_current_legal_documents(''2026-10-18'',''2026-10-18'')');
RESET ROLE;

-- authenticated user C (never accepted): isolation, no forging, RPC rules
SET ROLE authenticated; SET request.jwt.claim.sub = 'a1000000-0000-0000-0000-00000000000c';
INSERT INTO public.t_results SELECT 'legal: user sees only own rows (C has none, A and B exist)', count(*) = 0, 'C view' FROM public.legal_acceptances;
CALL public.expect_fail('legal: cannot insert own acceptance directly','INSERT INTO public.legal_acceptances(user_id,terms_version,privacy_version,accepted_at,method) VALUES (''a1000000-0000-0000-0000-00000000000c'',''2026-10-18'',''2026-10-18'',now(),''signup_checkbox'')');
CALL public.expect_fail('legal: cannot insert acceptance for another user','INSERT INTO public.legal_acceptances(user_id,terms_version,privacy_version,accepted_at,method) VALUES (''a1000000-0000-0000-0000-00000000000d'',''2026-10-18'',''2026-10-18'',now(),''signup_checkbox'')');
CALL public.expect_fail('legal: cannot update acceptances','UPDATE public.legal_acceptances SET accepted_at = now()');
CALL public.expect_fail('legal: cannot delete acceptances','DELETE FROM public.legal_acceptances');
CALL public.expect_fail('legal: cannot write the registry','INSERT INTO public.legal_document_versions(document,version) VALUES (''terms'',''2030-01-01'')');
CALL public.expect_fail('legal: cannot call signup trigger function','SELECT public.record_signup_legal_acceptance()');
CALL public.expect_fail('legal: RPC rejects stale terms version','SELECT public.accept_current_legal_documents(''2020-01-01'',''2026-10-18'')');
CALL public.expect_fail('legal: RPC rejects stale privacy version','SELECT public.accept_current_legal_documents(''2026-10-18'',''2020-01-01'')');
CALL public.expect_fail('legal: RPC rejects signup_checkbox method','SELECT public.accept_current_legal_documents(''2026-10-18'',''2026-10-18'',''signup_checkbox'')');
CALL public.expect_ok('legal: RPC accepts current versions','SELECT public.accept_current_legal_documents(''2026-10-18'',''2026-10-18'')');
CALL public.expect_ok('legal: RPC is idempotent','SELECT public.accept_current_legal_documents(''2026-10-18'',''2026-10-18'')');
INSERT INTO public.t_results SELECT 'legal: RPC wrote one own row with server time and reacceptance method',
  count(*) = 1 AND bool_and(user_id = 'a1000000-0000-0000-0000-00000000000c' AND method = 'reacceptance_prompt' AND abs(extract(epoch FROM now() - accepted_at)) < 60), 'C view' FROM public.legal_acceptances;
RESET ROLE;

-- unauthenticated authenticated-role call (no sub) must fail
SET ROLE authenticated; RESET request.jwt.claim.sub; SET request.jwt.claim.sub = '';
CALL public.expect_fail('legal: RPC requires a user id','SELECT public.accept_current_legal_documents(''2026-10-18'',''2026-10-18'')');
RESET ROLE;

-- immutability holds even for the owner/service role
CALL public.expect_fail('legal: rows are immutable even for privileged roles','UPDATE public.legal_acceptances SET method = ''reacceptance_prompt''');

-- deletion with the account
DELETE FROM auth.users WHERE id = 'a1000000-0000-0000-0000-00000000000a';
INSERT INTO public.t_results
SELECT 'legal: acceptance rows are removed when the account is deleted', count(*) = 0, 'user A'
FROM public.legal_acceptances WHERE user_id = 'a1000000-0000-0000-0000-00000000000a';
