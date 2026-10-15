-- 20260101001400_harden_verification_metadata_guard.sql
-- Phase B.1: Harden account_state_guard to prevent client tampering with verification metadata.
-- Authenticated users may update preferences (ageMin, ageMax, distance) and transition verification.status
-- to 'pending' or 'none', but cannot:
--   1. Set verification.status to 'approved'
--   2. Demote or clear an existing 'approved' verification status set by admin/service_role
--   3. Inject or alter arbitrary metadata keys inside verification (e.g., verified_at, reviewer, badge, etc.)
-- service_role retains full, unrestricted write access to all account_state fields.

CREATE OR REPLACE FUNCTION public.account_state_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  _verif_keys text[];
  _new_verif jsonb;
  _old_verif jsonb;
  _new_status text;
  _old_status text;
BEGIN
  -- Bypass all restrictions for service_role (admin actions, backend scripts, webhooks)
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Ensure data is a JSON object
  IF jsonb_typeof(NEW.data) <> 'object' THEN
    RAISE EXCEPTION 'account_state data must be a JSON object';
  END IF;

  _new_verif := NEW.data -> 'verification';
  _old_verif := CASE WHEN OLD.data IS NOT NULL THEN OLD.data -> 'verification' ELSE NULL END;
  _new_status := CASE WHEN _new_verif IS NOT NULL THEN _new_verif ->> 'status' ELSE NULL END;
  _old_status := CASE WHEN _old_verif IS NOT NULL THEN _old_verif ->> 'status' ELSE NULL END;

  -- 1. Prevent client from setting status to 'approved'
  IF _new_status = 'approved' AND _old_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Verification status cannot be self-approved by client.';
  END IF;

  -- 2. Prevent client from demoting or overwriting an existing approved status
  IF _old_status = 'approved' AND _new_status IS DISTINCT FROM 'approved' THEN
    -- Automatically preserve the approved verification metadata rather than failing general preference updates
    NEW.data := jsonb_set(NEW.data, '{verification}', _old_verif);
    _new_verif := _old_verif;
    _new_status := 'approved';
  END IF;

  -- 3. If verification object is provided by client, prevent injecting unauthorized keys
  IF _new_verif IS NOT NULL AND jsonb_typeof(_new_verif) = 'object' AND _old_status IS DISTINCT FROM 'approved' THEN
    SELECT coalesce(array_agg(key), ARRAY[]::text[])
    INTO _verif_keys
    FROM jsonb_object_keys(_new_verif) AS key;

    -- Only 'status' is allowed in client-submitted verification object
    IF EXISTS (SELECT 1 FROM unnest(_verif_keys) k WHERE k <> 'status') THEN
      RAISE EXCEPTION 'Unauthorized verification metadata tampering: only status is client-modifiable';
    END IF;

    -- Only 'pending' or 'none' allowed when set by client
    IF _new_status IS NOT NULL AND _new_status NOT IN ('pending', 'none') THEN
      RAISE EXCEPTION 'Invalid verification status: client may only set pending or none';
    END IF;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.account_state_guard() FROM PUBLIC, anon, authenticated;
