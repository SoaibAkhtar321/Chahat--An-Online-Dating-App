-- Purpose-specific consent records for OPTIONAL processing: location discovery and push notifications (Step 3).
--
-- Scope and design
--  * Separate from Terms/Privacy acceptance (20260101003300_legal_acceptances.sql). Nothing here is recorded at sign-up
--    and nothing here is a condition of using the core app (profiles, discovery by city, likes, matches, chat).
--  * public.consent_notice_versions is the server-side registry of published notice versions per purpose. Client
--    constants (mobile/src/constants/consentNotices.ts) must match the newest rows (__tests__/consent.test.ts).
--    Publishing new notice text = a NEW migration inserting a new row; never edit an existing row.
--  * public.consent_records is an append-only event log: one row per decision (granted / withdrawn) with purpose, notice
--    version, authenticated user, method and SERVER time. The current state is the latest row per (user, purpose).
--    Clients can only SELECT their own rows; every write goes through set_my_consent() (SECURITY DEFINER, auth.uid()).
--  * Enforcement does not rely on the client:
--      - a trigger on discovery_locations rejects any insert/update unless location consent is currently granted;
--      - a trigger on push_devices rejects activating a device token unless push consent is currently granted.
--    Dispatch (materialize_push_deliveries) only targets active push_devices, so it needs no change.
--  * Withdrawal is applied in the same transaction as the decision: the stored discovery location is deleted, and
--    the user's push device tokens are deleted (their pending deliveries cascade). OS-level permissions are not
--    controlled by the server; the app explains how to revoke them in device settings.
--  * NO BACKFILL. Existing users have no consent rows, so they are treated as not having consented. The two data steps
--    at the end of this file therefore remove stored locations and push tokens that exist without any consent record.
--    Users start again from the in-app notice. Check the row counts on the target database before applying.
--  * Consent rows are removed with the account (ON DELETE CASCADE). Whether consent evidence must be retained after
--    deletion is a retention question for Indian legal review (same open question as legal_acceptances).
--  * Per-category notification preferences (matches / messages / likes / calls) stay in notification_preferences. They
--    refine what is sent; they are not consent.

CREATE TABLE public.consent_notice_versions (
  purpose      text        NOT NULL CHECK (purpose IN ('location_discovery', 'push_notifications')),
  version      text        NOT NULL CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (purpose, version)
);

INSERT INTO public.consent_notice_versions (purpose, version) VALUES
  ('location_discovery', '2026-10-18'),
  ('push_notifications', '2026-10-18');

CREATE TABLE public.consent_records (
  seq            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  purpose        text        NOT NULL,
  notice_version text        NOT NULL,
  decision       text        NOT NULL CHECK (decision IN ('granted', 'withdrawn')),
  method         text        NOT NULL CHECK (method IN ('in_app_notice', 'settings_toggle')),
  decided_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (purpose, notice_version) REFERENCES public.consent_notice_versions (purpose, version)
);
CREATE INDEX consent_records_latest_idx ON public.consent_records (user_id, purpose, seq DESC);

-- Evidence is immutable: no UPDATE, even for privileged roles (DELETE stays possible for account deletion).
CREATE OR REPLACE FUNCTION public.consent_records_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'consent_records rows are immutable' USING ERRCODE = '42501';
END $$;

CREATE TRIGGER consent_records_no_update
  BEFORE UPDATE ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION public.consent_records_immutable();

ALTER TABLE public.consent_notice_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.consent_notice_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.consent_records FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.consent_notice_versions TO authenticated;
GRANT SELECT ON public.consent_records TO authenticated;
GRANT ALL ON public.consent_notice_versions, public.consent_records TO service_role;

CREATE POLICY consent_versions_read ON public.consent_notice_versions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY consent_records_own_read ON public.consent_records
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Internal: is the latest decision for (user, purpose) a grant? Not callable by clients.
CREATE OR REPLACE FUNCTION public.has_active_consent(_uid uuid, _purpose text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT r.decision = 'granted'
       FROM public.consent_records r
      WHERE r.user_id = _uid AND r.purpose = _purpose
      ORDER BY r.seq DESC
      LIMIT 1),
    false)
$$;
REVOKE EXECUTE ON FUNCTION public.has_active_consent(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_consent(uuid, text) TO service_role;

-- Record a decision for the signed-in user. Only the CURRENT notice version can be granted, so a stale screen cannot
-- record consent to text the user was not shown. Repeating the current decision is a no-op (no duplicate evidence).
CREATE OR REPLACE FUNCTION public.set_my_consent(
  _purpose text,
  _notice_version text,
  _decision text,
  _method text DEFAULT 'in_app_notice'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid uuid := auth.uid();
  cur_version text;
  last_decision text;
  last_version text;
  rec public.consent_records%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF _decision IS NULL OR _decision NOT IN ('granted', 'withdrawn') THEN
    RAISE EXCEPTION 'Unsupported consent decision' USING ERRCODE = '22023';
  END IF;
  IF _method IS NULL OR _method NOT IN ('in_app_notice', 'settings_toggle') THEN
    RAISE EXCEPTION 'Unsupported consent method' USING ERRCODE = '22023';
  END IF;

  SELECT max(version) INTO cur_version FROM public.consent_notice_versions WHERE purpose = _purpose;
  IF cur_version IS NULL THEN
    RAISE EXCEPTION 'Unknown consent purpose' USING ERRCODE = '22023';
  END IF;
  IF _decision = 'granted' AND _notice_version IS DISTINCT FROM cur_version THEN
    RAISE EXCEPTION 'The notice has changed. Please review the current version.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('consent:' || uid::text || ':' || _purpose, 0));

  SELECT r.decision, r.notice_version INTO last_decision, last_version
    FROM public.consent_records r
   WHERE r.user_id = uid AND r.purpose = _purpose
   ORDER BY r.seq DESC LIMIT 1;

  IF _decision = 'granted' THEN
    IF last_decision IS DISTINCT FROM 'granted' OR last_version IS DISTINCT FROM cur_version THEN
      INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
      VALUES (uid, _purpose, cur_version, 'granted', _method)
      RETURNING * INTO rec;
    END IF;
  ELSE
    -- Withdrawal: record it only if there is something to withdraw, but ALWAYS apply the effects (idempotent).
    IF last_decision = 'granted' THEN
      INSERT INTO public.consent_records (user_id, purpose, notice_version, decision, method)
      VALUES (uid, _purpose, cur_version, 'withdrawn', _method)
      RETURNING * INTO rec;
    END IF;

    IF _purpose = 'location_discovery' THEN
      DELETE FROM public.discovery_locations WHERE user_id = uid;
    ELSIF _purpose = 'push_notifications' THEN
      -- Pending deliveries for these devices are removed by ON DELETE CASCADE.
      DELETE FROM public.push_devices WHERE user_id = uid;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'purpose', _purpose,
    'decision', _decision,
    'notice_version', coalesce(rec.notice_version, last_version, cur_version),
    'decided_at', rec.decided_at
  );
END $$;

-- Current state per purpose for the signed-in user (RLS applies: SECURITY INVOKER). decision is NULL when the user
-- has never decided. current_notice_version lets the app tell when a newer notice has been published.
CREATE OR REPLACE FUNCTION public.get_my_consents()
RETURNS TABLE (
  purpose text,
  current_notice_version text,
  decision text,
  notice_version text,
  decided_at timestamptz
) LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT p.purpose, p.current_notice_version, c.decision, c.notice_version, c.decided_at
    FROM (SELECT v.purpose, max(v.version) AS current_notice_version
            FROM public.consent_notice_versions v GROUP BY v.purpose) p
    LEFT JOIN LATERAL (
      SELECT r.decision, r.notice_version, r.decided_at
        FROM public.consent_records r
       WHERE r.user_id = (SELECT auth.uid()) AND r.purpose = p.purpose
       ORDER BY r.seq DESC LIMIT 1
    ) c ON true
   ORDER BY p.purpose
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_consent(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_consent(text, text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_my_consents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_consents() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.consent_records_immutable() FROM PUBLIC, anon, authenticated;

-- Server-side enforcement -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_location_consent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_active_consent(NEW.user_id, 'location_discovery') THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.enforce_location_consent() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER discovery_locations_require_consent
  BEFORE INSERT OR UPDATE ON public.discovery_locations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_location_consent();

CREATE OR REPLACE FUNCTION public.enforce_push_consent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_active_consent(NEW.user_id, 'push_notifications') THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.enforce_push_consent() FROM PUBLIC, anon, authenticated;

-- Deactivating a token (what the dispatcher does for dead tokens) never needs consent, so only ACTIVE rows are checked.
CREATE TRIGGER push_devices_require_consent
  BEFORE INSERT OR UPDATE ON public.push_devices
  FOR EACH ROW WHEN (NEW.active)
  EXECUTE FUNCTION public.enforce_push_consent();

-- Existing data without any consent record (no backfill; see header) ------------------------------------------------
DELETE FROM public.discovery_locations l
 WHERE NOT public.has_active_consent(l.user_id, 'location_discovery');

DELETE FROM public.push_devices d
 WHERE NOT public.has_active_consent(d.user_id, 'push_notifications');
