-- 20260101004100_notifications_and_call_lifecycle_hardening.sql
-- Chahat Notification & Call Reliability Hardening
-- 1. Near-real-time push dispatch trigger (H-1): fires async net.http_post to dispatch-push when outbox rows are inserted.
-- 2. Safe, bounded retention cleanup routine (M-4): purges terminal deliveries and processed outbox records older than retention window.
-- 3. Dedicated indexes for bounded retention cleanup.

BEGIN;

-- ---------- 1. Near-real-time push dispatch trigger (H-1) ----------
CREATE OR REPLACE FUNCTION public.trigger_push_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _url text;
  _secret text;
BEGIN
  -- Only attempt async dispatch via pg_net if net schema and vault secrets are present
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net')
     AND to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    BEGIN
      SELECT decrypted_secret INTO _url
      FROM vault.decrypted_secrets
      WHERE name = 'chahat_project_url' LIMIT 1;

      SELECT decrypted_secret INTO _secret
      FROM vault.decrypted_secrets
      WHERE name = 'chahat_push_dispatch_secret' LIMIT 1;

      IF _url IS NOT NULL AND _secret IS NOT NULL THEN
        PERFORM net.http_post(
          url := _url || '/functions/v1/dispatch-push',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-dispatch-secret', _secret
          ),
          body := '{}'::jsonb
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Asynchronous notification dispatch must never block or abort business transactions.
      -- pg_cron will pick up queued outbox entries during its regular sweep.
      NULL;
    END;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_push_dispatch() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_push_dispatch_on_outbox ON public.notification_outbox;
CREATE TRIGGER trg_push_dispatch_on_outbox
  AFTER INSERT ON public.notification_outbox
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_push_dispatch();

-- ---------- 2. Bounded retention cleanup function (M-4) ----------
CREATE OR REPLACE FUNCTION public.purge_notification_history(
  _retention_days integer DEFAULT 30,
  _batch_size integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _purged_deliveries integer := 0;
  _purged_outbox integer := 0;
  _cutoff timestamptz;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  IF _retention_days IS NULL OR _retention_days < 1 OR _retention_days > 365 THEN
    RAISE EXCEPTION 'Invalid retention period: must be between 1 and 365 days';
  END IF;

  IF _batch_size IS NULL OR _batch_size < 1 OR _batch_size > 5000 THEN
    RAISE EXCEPTION 'Invalid batch size: must be between 1 and 5000';
  END IF;

  _cutoff := now() - make_interval(days => _retention_days);

  -- 1. Purge terminal deliveries older than the retention cutoff in a bounded batch.
  DELETE FROM public.notification_deliveries d
  WHERE d.ctid IN (
    SELECT x.ctid
    FROM public.notification_deliveries x
    WHERE x.status IN ('delivered', 'failed', 'suppressed')
      AND x.created_at < _cutoff
    LIMIT _batch_size
  );
  GET DIAGNOSTICS _purged_deliveries = ROW_COUNT;

  -- 2. Purge processed outbox records older than the retention cutoff that have no remaining deliveries.
  DELETE FROM public.notification_outbox o
  WHERE o.ctid IN (
    SELECT x.ctid
    FROM public.notification_outbox x
    WHERE x.processed_at IS NOT NULL
      AND x.created_at < _cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_deliveries d
        WHERE d.notification_id = x.id
      )
    LIMIT _batch_size
  );
  GET DIAGNOSTICS _purged_outbox = ROW_COUNT;

  RETURN jsonb_build_object(
    'purged_deliveries', _purged_deliveries,
    'purged_outbox', _purged_outbox,
    'retention_days', _retention_days,
    'cutoff', _cutoff
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_notification_history(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_notification_history(integer, integer) TO service_role;

-- ---------- 3. Dedicated indexes for cleanup efficiency ----------
CREATE INDEX IF NOT EXISTS notification_deliveries_cleanup_idx
  ON public.notification_deliveries (created_at)
  WHERE status IN ('delivered', 'failed', 'suppressed');

CREATE INDEX IF NOT EXISTS notification_outbox_cleanup_idx
  ON public.notification_outbox (created_at)
  WHERE processed_at IS NOT NULL;

COMMIT;
