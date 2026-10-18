-- Step 5: account deletion hardening. STAGED FILE: do not apply to the live Supabase project without review.
--
-- 1. purge_user_data() is made idempotent with respect to its audit trail: a retry no longer adds a duplicate
--    'account_self_deleted' row for the same (anonymised) target. All other behaviour is copied unchanged from
--    20260101002200_lifecycle_entitlements_release.sql.
-- 2. find_orphaned_chat_folders(): READ-ONLY helper (service_role only) that lists chat/<folder> storage prefixes whose
--    match row no longer exists (unmatch, block or account deletion removes the match but not its storage objects).
--    It deletes nothing; it exists so the operator can measure the problem before deciding on a cleanup.
--
-- Deliberately NOT changed (open legal/product decisions, see docs/ACCOUNT_DELETION.md):
--   * coin_transactions / coin_wallets are still erased by ON DELETE CASCADE from auth.users.
--   * legal_acceptances / consent_records are still erased by ON DELETE CASCADE from auth.users.
--   * no retention periods are invented here.
BEGIN;

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

  -- One audit event per deleted account, however many times the deletion is retried.
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_audit
    WHERE action = 'account_self_deleted' AND target = 'deleted:' || md5(_user_id)
  ) THEN
    INSERT INTO public.admin_audit (admin_id, action, target, note)
    VALUES (
      _anonymized_id,
      'account_self_deleted',
      'deleted:' || md5(_user_id),
      'User data purged; auth user and media removed'
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;

-- Read-only: chat storage prefixes with no matching match row.
CREATE OR REPLACE FUNCTION public.find_orphaned_chat_folders()
RETURNS TABLE (folder text, object_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
  SELECT (storage.foldername(o.name))[1] AS folder, count(*) AS object_count
  FROM storage.objects o
  WHERE o.bucket_id = 'chat'
    AND NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id::text = (storage.foldername(o.name))[1])
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.find_orphaned_chat_folders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_orphaned_chat_folders() TO service_role;

COMMIT;
