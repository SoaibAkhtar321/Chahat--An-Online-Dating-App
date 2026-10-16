-- Phase 4: coin wallets, append-only ledger and server-metered call billing.
--
-- Design (see docs/BILLING.md):
--   * Every balance change goes through public.apply_coin_transaction(), which is NOT callable by
--     any client role. Wallets and the ledger are read-only to clients (RLS, own rows only).
--   * The CALLER pays. Premium, Plus and VIP callers are exempt. The first minute is free.
--   * Call time is metered by the SERVER, never reported by a client. Coverage of a call is
--     video_calls.free_call_until: the first free minute, then one prepaid minute at a time, extended
--     only by public.extend_call_coverage() (service_role, called by issue-call-token after it has
--     verified the participant). No function accepts a duration from a client.
--   * Prepaid minutes that were never started are refunded when the call ends (settlement trigger),
--     so a call shorter than the free minute always costs nothing.
-- Idempotent: safe to re-apply. No payment provider, price or coin pack is created here.

-- ---------- 1. Configurable billing defaults (server-side only) ----------
-- 1 coin = 50 paise (INR 0.50). Informational for display and the future purchase flow.
INSERT INTO public.app_settings (key, value) VALUES
  ('coin_value_paise', '50'::jsonb),
  ('call_rate_audio_coins_per_minute', '4'::jsonb),
  ('call_rate_video_coins_per_minute', '10'::jsonb),
  ('call_free_seconds', '60'::jsonb),
  ('call_extension_lead_seconds', '20'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Fails closed: a missing key uses the default, but a malformed or out-of-range value raises instead
-- of silently charging the wrong amount.
CREATE OR REPLACE FUNCTION public.billing_setting_int(
  _key text, _default integer, _min integer, _max integer
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _raw text;
  _value integer;
BEGIN
  SELECT value #>> '{}' INTO _raw FROM public.app_settings WHERE key = _key;
  IF _raw IS NULL THEN
    _value := _default;
  ELSIF _raw !~ '^[0-9]{1,9}$' THEN
    RAISE EXCEPTION 'Invalid billing setting: %', _key;
  ELSE
    _value := _raw::integer;
  END IF;
  IF _value < _min OR _value > _max THEN
    RAISE EXCEPTION 'Invalid billing setting: %', _key;
  END IF;
  RETURN _value;
END
$$;

CREATE OR REPLACE FUNCTION public.call_rate_per_minute(_call_type text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _call_type = 'video' THEN
    RETURN public.billing_setting_int('call_rate_video_coins_per_minute', 10, 1, 100000);
  ELSIF _call_type = 'audio' THEN
    RETURN public.billing_setting_int('call_rate_audio_coins_per_minute', 4, 1, 100000);
  END IF;
  RAISE EXCEPTION 'Unsupported call type';
END
$$;

-- ---------- 2. Wallets and the append-only ledger ----------
CREATE TABLE IF NOT EXISTS public.coin_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0 AND balance <= 1000000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coin_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('purchase', 'grant', 'refund', 'adjustment', 'call_charge')),
  amount bigint NOT NULL CHECK (amount <> 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  call_id uuid,  -- deliberately no FK: the ledger must outlive call rows
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coin_transactions_sign_check CHECK (
    (kind = 'call_charge' AND amount < 0)
    OR (kind IN ('purchase', 'grant', 'refund') AND amount > 0)
    OR kind = 'adjustment'
  ),
  CONSTRAINT coin_transactions_call_charge_call_check CHECK (kind <> 'call_charge' OR call_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS coin_transactions_idempotency_key_idx
  ON public.coin_transactions (idempotency_key);
CREATE INDEX IF NOT EXISTS coin_transactions_user_created_idx
  ON public.coin_transactions (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS coin_transactions_call_idx
  ON public.coin_transactions (call_id) WHERE call_id IS NOT NULL;

-- Append-only. The only permitted delete is the cascade from deleting the owning auth user
-- (account deletion): at that point the user row is already gone.
CREATE OR REPLACE FUNCTION public.coin_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'coin_transactions is append-only';
END
$$;

DROP TRIGGER IF EXISTS coin_transactions_append_only ON public.coin_transactions;
CREATE TRIGGER coin_transactions_append_only
  BEFORE UPDATE OR DELETE ON public.coin_transactions
  FOR EACH ROW EXECUTE FUNCTION public.coin_ledger_append_only();

CREATE OR REPLACE FUNCTION public.coin_ledger_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'coin_transactions is append-only';
END
$$;

DROP TRIGGER IF EXISTS coin_transactions_no_truncate ON public.coin_transactions;
CREATE TRIGGER coin_transactions_no_truncate
  BEFORE TRUNCATE ON public.coin_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION public.coin_ledger_no_truncate();

ALTER TABLE public.coin_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_transactions ENABLE ROW LEVEL SECURITY;

-- Clients (and even service_role) can only READ. Writes happen exclusively inside the
-- SECURITY DEFINER functions below, which run as the table owner.
REVOKE ALL ON public.coin_wallets FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.coin_transactions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.coin_wallets TO authenticated, service_role;
-- Column-level grant keeps idempotency keys and internal metadata away from clients.
GRANT SELECT (id, user_id, kind, amount, balance_after, call_id, created_at)
  ON public.coin_transactions TO authenticated;
GRANT SELECT ON public.coin_transactions TO service_role;

DROP POLICY IF EXISTS "own wallet read" ON public.coin_wallets;
CREATE POLICY "own wallet read" ON public.coin_wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own coin transactions read" ON public.coin_transactions;
CREATE POLICY "own coin transactions read" ON public.coin_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ---------- 3. The single balance-mutation primitive (internal; no client or service grant) ----------
-- Returns jsonb: { ok, applied, replayed?, code?, transaction_id?, balance }.
--   * ok=false, code='insufficient_coins' when the debit would make the balance negative (no change).
--   * Replaying the same idempotency key with the same parameters is a no-op (applied=false).
--   * Reusing a key with different parameters raises.
-- Lock order used everywhere: call row, then this key's advisory lock, then the wallet row.
CREATE OR REPLACE FUNCTION public.apply_coin_transaction(
  _user_id uuid,
  _kind text,
  _amount bigint,
  _idempotency_key text,
  _call_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _wallet public.coin_wallets;
  _existing public.coin_transactions;
  _new_balance bigint;
  _txn uuid;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'User required'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('purchase', 'grant', 'refund', 'adjustment', 'call_charge') THEN
    RAISE EXCEPTION 'Unsupported coin transaction kind';
  END IF;
  IF _amount IS NULL OR _amount = 0 OR abs(_amount) > 100000000 THEN
    RAISE EXCEPTION 'Invalid coin amount';
  END IF;
  IF (_kind = 'call_charge' AND _amount > 0)
     OR (_kind IN ('purchase', 'grant', 'refund') AND _amount < 0) THEN
    RAISE EXCEPTION 'Coin amount has the wrong sign for this transaction kind';
  END IF;
  IF _kind = 'call_charge' AND _call_id IS NULL THEN
    RAISE EXCEPTION 'A call charge must reference a call';
  END IF;
  IF _idempotency_key IS NULL OR char_length(_idempotency_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'Invalid idempotency key';
  END IF;
  IF _metadata IS NULL OR jsonb_typeof(_metadata) <> 'object' OR pg_column_size(_metadata) > 2048 THEN
    RAISE EXCEPTION 'Invalid transaction metadata';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('coin-key:' || _idempotency_key, 401));

  INSERT INTO public.coin_wallets (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO _wallet FROM public.coin_wallets WHERE user_id = _user_id FOR UPDATE;

  SELECT * INTO _existing FROM public.coin_transactions WHERE idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF _existing.user_id = _user_id AND _existing.kind = _kind AND _existing.amount = _amount
       AND _existing.call_id IS NOT DISTINCT FROM _call_id THEN
      RETURN jsonb_build_object(
        'ok', true, 'applied', false, 'replayed', true,
        'transaction_id', _existing.id, 'balance', _wallet.balance
      );
    END IF;
    RAISE EXCEPTION 'Idempotency key was already used for a different transaction';
  END IF;

  _new_balance := _wallet.balance + _amount;
  IF _new_balance < 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'applied', false, 'code', 'insufficient_coins', 'balance', _wallet.balance
    );
  END IF;

  INSERT INTO public.coin_transactions
    (user_id, kind, amount, balance_after, idempotency_key, call_id, metadata)
  VALUES
    (_user_id, _kind, _amount, _new_balance, _idempotency_key, _call_id, _metadata)
  RETURNING id INTO _txn;

  UPDATE public.coin_wallets SET balance = _new_balance, updated_at = now()
  WHERE user_id = _user_id;

  RETURN jsonb_build_object(
    'ok', true, 'applied', true, 'transaction_id', _txn, 'balance', _new_balance
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.apply_coin_transaction(uuid, text, bigint, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Credit for a purchase that the (future) purchase adapter has already VERIFIED with the store.
-- _order_ref must be the store's unique order identifier so a replay can never credit twice.
-- Nothing in this build calls it: the coin purchase adapter is not configured.
CREATE OR REPLACE FUNCTION public.credit_coins_from_purchase(
  _user_id uuid, _coins bigint, _order_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _order_ref IS NULL OR _order_ref !~ '^[A-Za-z0-9._:=-]{8,160}$' THEN
    RAISE EXCEPTION 'Invalid order reference';
  END IF;
  RETURN public.apply_coin_transaction(
    _user_id, 'purchase', _coins, 'purchase:' || _order_ref, NULL,
    jsonb_build_object('source', 'verified_purchase')
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.credit_coins_from_purchase(uuid, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_coins_from_purchase(uuid, bigint, text) TO service_role;

-- ---------- 4. Client read API ----------
CREATE OR REPLACE FUNCTION public.get_my_wallet()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN jsonb_build_object(
    'balance', coalesce((SELECT balance FROM public.coin_wallets WHERE user_id = _uid), 0),
    'coin_value_paise', public.billing_setting_int('coin_value_paise', 50, 1, 100000),
    'free_call_seconds', public.billing_setting_int('call_free_seconds', 60, 10, 3600),
    'audio_coins_per_minute', public.call_rate_per_minute('audio'),
    'video_coins_per_minute', public.call_rate_per_minute('video')
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_wallet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_wallet() TO authenticated;

-- ---------- 5. Call billing columns (written only by definer functions) ----------
ALTER TABLE public.video_calls
  ADD COLUMN IF NOT EXISTS billing_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_rate_coins integer CHECK (billing_rate_coins IS NULL OR billing_rate_coins > 0),
  ADD COLUMN IF NOT EXISTS billing_free_seconds integer CHECK (billing_free_seconds IS NULL OR billing_free_seconds >= 0),
  ADD COLUMN IF NOT EXISTS billed_minutes integer NOT NULL DEFAULT 0 CHECK (billed_minutes >= 0),
  ADD COLUMN IF NOT EXISTS coins_charged bigint NOT NULL DEFAULT 0 CHECK (coins_charged >= 0),
  ADD COLUMN IF NOT EXISTS duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

COMMENT ON COLUMN public.video_calls.free_call_until IS
  'End of the time the server has authorised for this call: the free minute, then one prepaid minute at a time. NULL means unmetered (exempt caller). Never set from a client.';

-- Participants may read their own call rows but not the payer''s spending: grant explicit columns.
REVOKE SELECT ON public.video_calls FROM authenticated;
GRANT SELECT (id, match_id, caller_id, recipient_id, call_type, status, created_at, expires_at,
              accepted_at, ended_at, free_call_until)
  ON public.video_calls TO authenticated;

-- ---------- 6. Accept: decide payer exemption and the free window on the server ----------
CREATE OR REPLACE FUNCTION public.transition_video_call(_call_id uuid, _action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _call public.video_calls;
  _exempt boolean;
  _free_seconds integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _action NOT IN ('accept', 'decline', 'cancel', 'end') THEN RAISE EXCEPTION 'Invalid call action'; END IF;

  SELECT * INTO _call FROM public.video_calls
  WHERE id = _call_id AND _uid IN (caller_id, recipient_id)
  FOR UPDATE;
  IF _call.id IS NULL THEN RAISE EXCEPTION 'Call not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.profiles caller_profile ON caller_profile.id = _call.caller_id::text
    JOIN public.profiles recipient_profile ON recipient_profile.id = _call.recipient_id::text
    WHERE m.id = _call.match_id
      AND NOT public.is_blocked_pair(m.user_a, m.user_b)
      AND caller_profile.status = 'active' AND caller_profile.onboarded AND NOT caller_profile.is_demo
      AND recipient_profile.status = 'active' AND recipient_profile.onboarded AND NOT recipient_profile.is_demo
  ) THEN
    IF _call.status IN ('pending', 'accepted') THEN
      UPDATE public.video_calls SET status = 'ended', ended_at = now() WHERE id = _call.id;
    END IF;
    RETURN jsonb_build_object('success', false, 'status', 'ended', 'error', 'Participants are no longer eligible');
  END IF;

  IF _call.status = 'pending' AND _call.expires_at <= now() THEN
    UPDATE public.video_calls SET status = 'timed_out', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', false, 'status', 'timed_out');
  END IF;
  IF _call.status = 'accepted' AND _call.free_call_until IS NOT NULL
     AND _call.free_call_until <= now() THEN
    UPDATE public.video_calls SET status = 'ended', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'ended');
  END IF;

  IF _action = 'accept' AND _uid = _call.recipient_id AND _call.status = 'pending' THEN
    -- The caller pays. A paid-tier caller is exempt; everyone else gets a free window and must
    -- then hold coins for each further minute. Rates are snapshotted so a mid-call settings change
    -- cannot alter what an in-flight call costs.
    _exempt := public.get_active_subscription_tier(_call.caller_id::text) <> 'free';
    _free_seconds := public.billing_setting_int('call_free_seconds', 60, 10, 3600);
    UPDATE public.video_calls
      SET status = 'accepted',
          accepted_at = now(),
          billing_exempt = _exempt,
          billing_rate_coins = CASE WHEN _exempt THEN NULL ELSE public.call_rate_per_minute(_call.call_type) END,
          billing_free_seconds = CASE WHEN _exempt THEN NULL ELSE _free_seconds END,
          free_call_until = CASE WHEN _exempt THEN NULL ELSE now() + make_interval(secs => _free_seconds) END
      WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'accepted');
  ELSIF _action = 'decline' AND _uid = _call.recipient_id AND _call.status = 'pending' THEN
    UPDATE public.video_calls SET status = 'declined', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'declined');
  ELSIF _action = 'cancel' AND _uid = _call.caller_id AND _call.status = 'pending' THEN
    UPDATE public.video_calls SET status = 'cancelled', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'cancelled');
  ELSIF _action = 'end' AND _call.status = 'accepted' THEN
    UPDATE public.video_calls SET status = 'ended', ended_at = now() WHERE id = _call.id;
    RETURN jsonb_build_object('success', true, 'status', 'ended');
  END IF;

  RAISE EXCEPTION 'Invalid call transition';
END
$$;

-- ---------- 7. Extending coverage (the only place a call is charged) ----------
-- Called by issue-call-token (service_role) with the user id taken from the verified JWT.
-- A minute is charged only when less than call_extension_lead_seconds of covered time remain, so
-- coverage never runs more than lead + 60 seconds ahead of the server clock, and repeated or
-- concurrent calls cannot charge twice (row lock + per-minute idempotency key).
CREATE OR REPLACE FUNCTION public.extend_call_coverage(_call_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _call public.video_calls;
  _lead integer := public.billing_setting_int('call_extension_lead_seconds', 20, 1, 50);
  _remaining numeric;
  _rate integer;
  _minute integer;
  _charge jsonb;
BEGIN
  IF _call_id IS NULL OR _user_id IS NULL THEN RAISE EXCEPTION 'Call and user required'; END IF;

  SELECT * INTO _call FROM public.video_calls WHERE id = _call_id FOR UPDATE;
  IF _call.id IS NULL OR _user_id NOT IN (_call.caller_id, _call.recipient_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'call_not_found');
  END IF;
  IF _call.status <> 'accepted' OR _call.accepted_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'call_not_active');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.profiles caller_profile ON caller_profile.id = _call.caller_id::text
    JOIN public.profiles recipient_profile ON recipient_profile.id = _call.recipient_id::text
    WHERE m.id = _call.match_id
      AND NOT public.is_blocked_pair(m.user_a, m.user_b)
      AND caller_profile.status = 'active' AND caller_profile.onboarded AND NOT caller_profile.is_demo
      AND recipient_profile.status = 'active' AND recipient_profile.onboarded AND NOT recipient_profile.is_demo
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'call_not_allowed');
  END IF;

  IF _call.free_call_until IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'extended', false, 'exempt', true, 'covered_seconds_remaining', NULL);
  END IF;

  -- Entitlements are re-checked on the server: a caller who has since gone premium stops being billed.
  IF public.get_active_subscription_tier(_call.caller_id::text) <> 'free' THEN
    UPDATE public.video_calls SET billing_exempt = true, free_call_until = NULL WHERE id = _call.id;
    RETURN jsonb_build_object('ok', true, 'extended', false, 'exempt', true, 'covered_seconds_remaining', NULL);
  END IF;

  _remaining := extract(epoch FROM (_call.free_call_until - now()));
  IF _remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'call_expired');
  END IF;
  IF _remaining > _lead THEN
    RETURN jsonb_build_object(
      'ok', true, 'extended', false, 'exempt', false,
      'covered_seconds_remaining', ceil(_remaining)::integer
    );
  END IF;

  _rate := coalesce(_call.billing_rate_coins, public.call_rate_per_minute(_call.call_type));
  _minute := _call.billed_minutes + 1;
  _charge := public.apply_coin_transaction(
    _call.caller_id, 'call_charge', -_rate::bigint,
    'call:' || _call.id::text || ':minute:' || _minute::text,
    _call.id,
    jsonb_build_object('minute', _minute, 'rate', _rate, 'call_type', _call.call_type)
  );
  IF (_charge->>'ok')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', coalesce(_charge->>'code', 'charge_failed'),
      'covered_seconds_remaining', ceil(_remaining)::integer
    );
  END IF;

  UPDATE public.video_calls
    SET free_call_until = free_call_until + interval '60 seconds',
        billing_rate_coins = _rate,
        billed_minutes = _minute,
        coins_charged = coins_charged + _rate
    WHERE id = _call.id;

  RETURN jsonb_build_object(
    'ok', true, 'extended', true, 'exempt', false,
    'covered_seconds_remaining', ceil(_remaining + 60)::integer,
    'coins_charged', _rate
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.extend_call_coverage(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extend_call_coverage(uuid, uuid) TO service_role;

-- ---------- 8. Settlement: server-verified duration and refund of unstarted prepaid minutes ----------
-- Fires for every path that ends an accepted call (explicit end, lazy expiry sweeps, ineligibility),
-- so no code path can skip it. Idempotent through settled_at and the 'call:<id>:settle' ledger key.
CREATE OR REPLACE FUNCTION public.settle_video_call_billing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _duration integer;
  _free integer;
  _due integer;
  _excess integer;
  _rate integer;
  _refund bigint := 0;
BEGIN
  IF NEW.accepted_at IS NULL OR NEW.ended_at IS NULL OR NEW.settled_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- Time never counts beyond what the server authorised, nor beyond a day.
  _duration := greatest(0, least(86400, floor(extract(epoch FROM (
    least(NEW.ended_at, coalesce(NEW.free_call_until, NEW.ended_at)) - NEW.accepted_at
  )))))::integer;

  IF NOT NEW.billing_exempt AND NEW.billed_minutes > 0 THEN
    _free := coalesce(NEW.billing_free_seconds, public.billing_setting_int('call_free_seconds', 60, 10, 3600));
    _rate := coalesce(NEW.billing_rate_coins, public.call_rate_per_minute(NEW.call_type));
    _due := ceil(greatest(0, _duration - _free) / 60.0)::integer;
    _excess := greatest(0, NEW.billed_minutes - _due);
    IF _excess > 0 THEN
      _refund := _excess::bigint * _rate;
      PERFORM public.apply_coin_transaction(
        NEW.caller_id, 'refund', _refund,
        'call:' || NEW.id::text || ':settle', NEW.id,
        jsonb_build_object('unstarted_minutes', _excess, 'rate', _rate)
      );
    END IF;
  END IF;

  UPDATE public.video_calls
    SET settled_at = now(),
        duration_seconds = _duration,
        billed_minutes = billed_minutes - coalesce(_excess, 0),
        coins_charged = coins_charged - _refund
    WHERE id = NEW.id;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS video_calls_settle_billing ON public.video_calls;
CREATE TRIGGER video_calls_settle_billing
  AFTER UPDATE OF status ON public.video_calls
  FOR EACH ROW
  WHEN (NEW.status = 'ended' AND OLD.status IS DISTINCT FROM 'ended')
  EXECUTE FUNCTION public.settle_video_call_billing();

REVOKE EXECUTE ON FUNCTION public.settle_video_call_billing() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.coin_ledger_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.coin_ledger_no_truncate() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.billing_setting_int(text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.call_rate_per_minute(text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- 9. Join context: expose what issue-call-token needs to decide ----------
CREATE OR REPLACE FUNCTION public.get_call_join_context(_call_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _call public.video_calls;
  _eligible boolean;
BEGIN
  SELECT * INTO _call FROM public.video_calls WHERE id = _call_id;
  IF _call.id IS NULL OR _user_id IS NULL OR _user_id NOT IN (_call.caller_id, _call.recipient_id) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  _eligible := EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.profiles caller_profile ON caller_profile.id = _call.caller_id::text
    JOIN public.profiles recipient_profile ON recipient_profile.id = _call.recipient_id::text
    WHERE m.id = _call.match_id
      AND NOT public.is_blocked_pair(m.user_a, m.user_b)
      AND caller_profile.status = 'active' AND caller_profile.onboarded AND NOT caller_profile.is_demo
      AND recipient_profile.status = 'active' AND recipient_profile.onboarded AND NOT recipient_profile.is_demo
  );

  -- free_seconds_remaining keeps its Phase 3 name but now means "authorised seconds remaining"
  -- (free minute plus prepaid minutes). NULL means the call is unmetered.
  RETURN jsonb_build_object(
    'found', true,
    'status', _call.status,
    'call_type', _call.call_type,
    'eligible', _eligible,
    'accepted', _call.accepted_at IS NOT NULL,
    'free_seconds_remaining',
      CASE WHEN _call.free_call_until IS NULL THEN NULL
        ELSE greatest(0, ceil(extract(epoch FROM (_call.free_call_until - now())))::integer) END,
    'billing_exempt', _call.billing_exempt,
    'extension_lead_seconds', public.billing_setting_int('call_extension_lead_seconds', 20, 1, 50)
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.get_call_join_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_call_join_context(uuid, uuid) TO service_role;
