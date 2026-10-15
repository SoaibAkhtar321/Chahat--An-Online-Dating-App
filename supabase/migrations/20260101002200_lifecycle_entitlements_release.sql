-- Phase 7-9: account lifecycle and authoritative entitlement state.

ALTER TABLE public.subscription_orders
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.subscription_orders
  DROP CONSTRAINT IF EXISTS subscription_orders_user_id_fkey;

ALTER TABLE public.subscription_orders
  ADD CONSTRAINT subscription_orders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.get_daily_like_quota()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid text := auth.uid()::text;
  _today date := (timezone('Asia/Kolkata', now()))::date;
  _limit integer := public.setting_int('daily_like_limit', 20);
  _used integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT likes_used INTO _used
  FROM public.user_daily_quotas
  WHERE user_id = _uid AND ist_date = _today;

  RETURN jsonb_build_object(
    'daily_limit', greatest(0, _limit),
    'likes_remaining', greatest(0, _limit - coalesce(_used, 0)),
    'reset_at_ist', _today + 1
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_daily_like_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_like_quota() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_account_deletion(_uid uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'User ID required';
  END IF;

  UPDATE public.profiles
  SET status = 'suspended'
  WHERE id = _uid::text AND user_id = _uid;

  UPDATE public.account_state
  SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{deletionPending}', 'true'::jsonb, true),
      updated_at = now()
  WHERE user_id = _uid;

  IF to_regclass('public.push_devices') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.push_devices WHERE user_id = $1' USING _uid;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_account_deletion(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.account_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  _service_role boolean :=
    current_setting('request.jwt.claim.role', true) = 'service_role'
    OR coalesce(auth.role(), '') = 'service_role';
  _verif_keys text[];
  _new_verif jsonb;
  _old_verif jsonb;
  _new_status text;
  _old_status text;
BEGIN
  -- service_role (admin actions, backend scripts, webhooks) is unrestricted.
  IF _service_role THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.data) <> 'object' THEN
    RAISE EXCEPTION 'account_state data must be a JSON object';
  END IF;

  -- Server-controlled deletion state (phase 7-9).
  IF NEW.data->>'deletionPending' = 'true'
     AND (TG_OP = 'INSERT' OR OLD.data->>'deletionPending' IS DISTINCT FROM 'true') THEN
    RAISE EXCEPTION 'Deletion state is server controlled';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.data->>'deletionPending' = 'true' THEN
    RAISE EXCEPTION 'Account deletion is pending';
  END IF;

  -- Verification hardening (kept from 20260101001400; must not be dropped).
  _new_verif := NEW.data -> 'verification';
  _old_verif := CASE WHEN TG_OP = 'UPDATE' THEN OLD.data -> 'verification' ELSE NULL END;
  _new_status := _new_verif ->> 'status';
  _old_status := _old_verif ->> 'status';

  -- 1. Client cannot self-approve.
  IF _new_status = 'approved' AND _old_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Verification status cannot be self-approved by client.';
  END IF;

  -- 2. Client cannot demote/clear an approved status: preserve it silently so
  --    ordinary preference updates still succeed.
  IF _old_status = 'approved' AND _new_status IS DISTINCT FROM 'approved' THEN
    NEW.data := jsonb_set(NEW.data, '{verification}', _old_verif);
    _new_verif := _old_verif;
    _new_status := 'approved';
  END IF;

  -- 3. Client may only submit {status: pending|none}; no extra metadata keys.
  IF _new_verif IS NOT NULL AND jsonb_typeof(_new_verif) = 'object'
     AND _old_status IS DISTINCT FROM 'approved' THEN
    SELECT coalesce(array_agg(key), ARRAY[]::text[])
    INTO _verif_keys
    FROM jsonb_object_keys(_new_verif) AS key;

    IF EXISTS (SELECT 1 FROM unnest(_verif_keys) k WHERE k <> 'status') THEN
      RAISE EXCEPTION 'Unauthorized verification metadata tampering: only status is client-modifiable';
    END IF;
    IF _new_status IS NOT NULL AND _new_status NOT IN ('pending', 'none') THEN
      RAISE EXCEPTION 'Invalid verification status: client may only set pending or none';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.account_state_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.undo_swipe_pass(_target_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _my_id text := auth.uid()::text;
  _tier text;
  _deleted_count integer := 0;
BEGIN
  IF _my_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _target_id IS NULL OR _target_id = _my_id THEN RAISE EXCEPTION 'Target required'; END IF;

  _tier := public.get_active_subscription_tier(_my_id);
  IF _tier NOT IN ('premium', 'plus', 'vip') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'upgrade_required',
      'message', 'Rewind is only available on CHAHAT Premium, Plus, and VIP'
    );
  END IF;

  DELETE FROM public.swipes
  WHERE from_id = _my_id AND to_id = _target_id AND kind = 'pass';
  GET DIAGNOSTICS _deleted_count = ROW_COUNT;

  RETURN jsonb_build_object('success', _deleted_count > 0, 'undone', _deleted_count > 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_swipe_pass(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_swipe_pass(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.purge_user_data(_uid uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _user_id text;
  _table text;
  _column text;
  _relation regclass;
  _anonymized_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'User ID required'; END IF;
  _user_id := _uid::text;
  _anonymized_id := md5('deleted-account:' || _user_id)::uuid;

  DELETE FROM public.matches WHERE user_a = _user_id OR user_b = _user_id;
  DELETE FROM public.swipes WHERE from_id = _user_id OR to_id = _user_id;
  DELETE FROM public.blocks WHERE blocker = _user_id OR blocked = _user_id;
  DELETE FROM public.user_daily_quotas WHERE user_id = _user_id;
  DELETE FROM public.user_subscriptions WHERE user_id = _user_id;
  DELETE FROM public.photo_reviews WHERE owner_id = _user_id;

  -- Retain provider transaction evidence without retaining its Auth foreign-key identity.
  UPDATE public.subscription_orders SET user_id = NULL WHERE user_id = _uid;

  DELETE FROM public.account_state WHERE user_id = _uid;
  DELETE FROM public.profiles WHERE id = _user_id;

  UPDATE public.reports
  SET reporter = CASE WHEN reporter = _user_id THEN 'deleted:' || md5(_user_id) ELSE reporter END,
      target = CASE WHEN target = _user_id THEN 'deleted:' || md5(_user_id) ELSE target END
  WHERE reporter = _user_id OR target = _user_id;

  UPDATE public.admin_audit SET admin_id = _anonymized_id WHERE admin_id = _uid;
  UPDATE public.admin_audit
  SET target = 'deleted:' || md5(_user_id),
      note = CASE
        WHEN action = 'account_self_deleted' THEN 'User data purged; auth user and media removed'
        ELSE note
      END
  WHERE target = _user_id;

  -- Optional phase tables are cleaned when present; column checks keep this migration
  -- compatible with installations where those later-phase schemas are not yet applied.
  FOR _table, _column IN
    SELECT * FROM (VALUES
      ('push_devices', 'user_id'),
      ('notification_preferences', 'user_id'),
      ('notification_outbox', 'recipient_id'),
      ('notification_outbox', 'actor_id'),
      ('discovery_locations', 'user_id'),
      ('user_locations', 'user_id'),
      ('video_calls', 'caller_id'),
      ('video_calls', 'recipient_id'),
      ('video_calls', 'callee_id'),
      ('video_calls', 'user_a'),
      ('video_calls', 'user_b'),
      ('call_sessions', 'caller_id'),
      ('call_sessions', 'callee_id')
    ) AS optional_cleanup(table_name, column_name)
  LOOP
    _relation := to_regclass(format('public.%I', _table));
    IF _relation IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = _table AND column_name = _column
    ) THEN
      EXECUTE format('DELETE FROM %s WHERE %I::text = $1', _relation, _column) USING _user_id;
    END IF;
  END LOOP;

  INSERT INTO public.admin_audit (admin_id, action, target, note)
  VALUES (
    _anonymized_id,
    'account_self_deleted',
    'deleted:' || md5(_user_id),
    'User data purged; auth user and media removed'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;
