-- Legal acceptance evidence (Terms & Conditions + Privacy Policy), recorded server-side.
--
-- Design:
--  * public.legal_document_versions is the SERVER-SIDE registry of published document versions. The client constants in
--    mobile/src/constants/legalVersions.ts must match its newest rows (enforced by __tests__/legalVersions.test.ts).
--    Publishing a new version = a new migration inserting a new row (never edit an existing row).
--  * public.legal_acceptances is append-only evidence: user_id, accepted Terms/Privacy versions, timestamps, method.
--    Clients have SELECT on their own rows only; every write goes through the SECURITY DEFINER paths below, which use
--    auth.uid() / auth.users data and server time, never client-supplied identity or timestamps.
--  * Signup path: the app sends the versions the user agreed to as signUp user metadata (key legal_acceptance). A
--    trigger on auth.users records them ONLY once the e-mail is confirmed (so an unconfirmed sign-up for someone else's
--    address never produces evidence), only for versions that exist in the registry, with accepted_at = the server-side
--    sign-up time (auth.users.created_at). Missing or unknown claims record nothing.
--  * Re-acceptance path: accept_current_legal_documents() for an authenticated user; it only accepts the CURRENT
--    versions, so a stale screen cannot record acceptance of text the user was not shown.
--  * NO BACKFILL: existing users get no rows. They are treated as not having accepted any version.
--  * Rows are deleted with the account (ON DELETE CASCADE from auth.users). Whether acceptance evidence must be retained
--    after deletion is a retention question flagged for Indian legal review.
--  * Optional, purpose-specific consents (location, push, ...) are NOT stored here; they get their own records later.

CREATE TABLE public.legal_document_versions (
  document     text        NOT NULL CHECK (document IN ('terms', 'privacy')),
  version      text        NOT NULL CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document, version)
);

INSERT INTO public.legal_document_versions (document, version) VALUES
  ('terms',   '2026-10-18'),
  ('privacy', '2026-10-18');

CREATE TABLE public.legal_acceptances (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  terms_version   text        NOT NULL,
  privacy_version text        NOT NULL,
  accepted_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  method          text        NOT NULL CHECK (method IN ('signup_checkbox', 'reacceptance_prompt')),
  CONSTRAINT legal_acceptances_unique_versions UNIQUE (user_id, terms_version, privacy_version)
);

-- Evidence is immutable: no UPDATE, even for privileged roles (DELETE stays possible for account deletion).
CREATE OR REPLACE FUNCTION public.legal_acceptances_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'legal_acceptances rows are immutable' USING ERRCODE = '42501';
END $$;

CREATE TRIGGER legal_acceptances_no_update
  BEFORE UPDATE ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.legal_acceptances_immutable();

-- Privileges and RLS: reads only, own rows only; the registry is public read-only.
ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.legal_document_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.legal_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.legal_document_versions TO anon, authenticated;
GRANT SELECT ON public.legal_acceptances TO authenticated;
GRANT ALL ON public.legal_document_versions, public.legal_acceptances TO service_role;

CREATE POLICY legal_versions_public_read ON public.legal_document_versions
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY legal_acceptances_own_read ON public.legal_acceptances
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Signup path: runs when the e-mail becomes confirmed (or immediately if the project auto-confirms).
CREATE OR REPLACE FUNCTION public.record_signup_legal_acceptance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  claim jsonb;
  tv text;
  pv text;
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NOT NULL THEN RETURN NEW; END IF;

  claim := NEW.raw_user_meta_data -> 'legal_acceptance';
  IF jsonb_typeof(claim) IS DISTINCT FROM 'object' THEN RETURN NEW; END IF;
  tv := claim ->> 'terms_version';
  pv := claim ->> 'privacy_version';

  IF EXISTS (SELECT 1 FROM public.legal_document_versions WHERE document = 'terms' AND version = tv)
     AND EXISTS (SELECT 1 FROM public.legal_document_versions WHERE document = 'privacy' AND version = pv) THEN
    INSERT INTO public.legal_acceptances (user_id, terms_version, privacy_version, accepted_at, method)
    VALUES (NEW.id, tv, pv, COALESCE(NEW.created_at, now()), 'signup_checkbox')
    ON CONFLICT ON CONSTRAINT legal_acceptances_unique_versions DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block sign-in/confirmation because evidence could not be written; the user is simply treated as not having
  -- accepted and will be asked again by the version-aware acceptance flow.
  RAISE WARNING 'record_signup_legal_acceptance failed: %', SQLERRM;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_legal_acceptance_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW WHEN (NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.record_signup_legal_acceptance();

CREATE TRIGGER on_auth_user_legal_acceptance_confirm
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.record_signup_legal_acceptance();

-- Re-acceptance path (signed-in users). The caller states which versions they were shown; only the current ones are valid.
CREATE OR REPLACE FUNCTION public.accept_current_legal_documents(
  _terms_version text,
  _privacy_version text,
  _method text DEFAULT 'reacceptance_prompt'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid uuid := auth.uid();
  cur_terms text;
  cur_privacy text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF _method IS DISTINCT FROM 'reacceptance_prompt' THEN
    RAISE EXCEPTION 'Unsupported acceptance method' USING ERRCODE = '22023';
  END IF;

  SELECT max(version) INTO cur_terms FROM public.legal_document_versions WHERE document = 'terms';
  SELECT max(version) INTO cur_privacy FROM public.legal_document_versions WHERE document = 'privacy';
  IF _terms_version IS DISTINCT FROM cur_terms OR _privacy_version IS DISTINCT FROM cur_privacy THEN
    RAISE EXCEPTION 'The legal documents have changed. Please review the current versions.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.legal_acceptances (user_id, terms_version, privacy_version, accepted_at, method)
  VALUES (uid, cur_terms, cur_privacy, now(), 'reacceptance_prompt')
  ON CONFLICT ON CONSTRAINT legal_acceptances_unique_versions DO NOTHING;
END $$;

REVOKE EXECUTE ON FUNCTION public.record_signup_legal_acceptance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.legal_acceptances_immutable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_current_legal_documents(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_current_legal_documents(text, text, text) TO authenticated, service_role;
