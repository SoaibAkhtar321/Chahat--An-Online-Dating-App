-- 20260101006800_scale_storage_and_data_access.sql
-- Pre-launch audit (2026-10-30). Forward-only; no existing policy or RPC signature is changed.
--
-- 1. Storage: the 'photos' bucket now accepts at most 2 MB per file (was 5 MB). The app already shrinks every
--    profile photo to under 1 MB before upload, so 2 MB only stops oversized uploads from old or modified clients
--    from filling storage. The 'chat' bucket keeps 5 MB (animated GIFs from the keyboard); chat photos are now
--    shrunk on the phone to under ~600 KB before upload.
--
-- 2. Indexes for growth: foreign keys and hot lookups that had no index (cascade deletes on unmatch / account
--    deletion and the call-expiry job scanned whole tables).
--
-- 3. export_my_data(): a member's own data, for "Download my data" (DPDP Act 2023, s.11 right to a summary of
--    personal data being processed). Own data only; no other member's messages or private data; no push tokens,
--    purchase tokens or internal moderation notes.
BEGIN;

-- ---------- 1. Storage limits ----------
UPDATE storage.buckets SET file_size_limit = 2097152 WHERE id = 'photos';

-- ---------- 2. Indexes ----------
CREATE INDEX IF NOT EXISTS video_calls_match_idx ON public.video_calls (match_id);
CREATE INDEX IF NOT EXISTS video_calls_pending_expiry_idx ON public.video_calls (expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS video_calls_accepted_idx ON public.video_calls (accepted_at) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS call_events_call_idx ON public.call_events (call_id);
CREATE INDEX IF NOT EXISTS call_events_created_idx ON public.call_events (created_at);
CREATE INDEX IF NOT EXISTS message_reactions_user_idx ON public.message_reactions (user_id);
CREATE INDEX IF NOT EXISTS notification_deliveries_device_idx ON public.notification_deliveries (device_id);
CREATE INDEX IF NOT EXISTS messages_viewed_by_idx ON public.messages (viewed_by) WHERE viewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON public.reports (reporter);

-- ---------- 3. Download my data ----------
CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _id text := auth.uid()::text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'notes', 'Your personal data held by Chahat. Messages are the ones you sent (latest 2000). Photos and voice '
             || 'notes are listed by file name; you can see them in the app. Other members'' messages and data '
             || 'are not included.',
    'account', (SELECT jsonb_build_object('email', u.email, 'created_at', u.created_at)
                FROM auth.users u WHERE u.id = _uid),
    'profile', (SELECT to_jsonb(p) - 'user_id' - 'is_demo' - 'likes_you' FROM public.profiles p WHERE p.id = _id),
    'location', (SELECT jsonb_build_object('latitude', l.latitude, 'longitude', l.longitude, 'updated_at', l.updated_at)
                 FROM public.discovery_locations l WHERE l.user_id = _uid),
    'location_settings', (SELECT to_jsonb(s) - 'user_id' FROM public.discovery_location_settings s WHERE s.user_id = _uid),
    'notification_preferences', (SELECT to_jsonb(n) - 'user_id' FROM public.notification_preferences n WHERE n.user_id = _uid),
    'devices', coalesce((SELECT jsonb_agg(jsonb_build_object('platform', d.platform, 'app_version', d.app_version,
                          'active', d.active, 'last_seen_at', d.last_seen_at) ORDER BY d.last_seen_at DESC)
                         FROM public.push_devices d WHERE d.user_id = _uid), '[]'::jsonb),
    'consents', coalesce((SELECT jsonb_agg(jsonb_build_object('purpose', c.purpose, 'decision', c.decision,
                           'notice_version', c.notice_version, 'decided_at', c.decided_at) ORDER BY c.decided_at)
                          FROM public.consent_records c WHERE c.user_id = _uid), '[]'::jsonb),
    'legal_acceptances', coalesce((SELECT jsonb_agg(to_jsonb(a) - 'user_id' - 'id' ORDER BY a.accepted_at)
                                   FROM public.legal_acceptances a WHERE a.user_id = _uid), '[]'::jsonb),
    'subscription', (SELECT to_jsonb(s) - 'user_id' - 'source_order_id' FROM public.user_subscriptions s WHERE s.user_id = _id),
    'purchases', coalesce((SELECT jsonb_agg(jsonb_build_object('store', o.store, 'product_id', o.product_id,
                            'tier', o.tier, 'amount_inr', o.amount_inr, 'starts_at', o.starts_at,
                            'expires_at', o.expires_at, 'created_at', o.created_at) ORDER BY o.created_at)
                           FROM public.subscription_orders o WHERE o.user_id = _uid), '[]'::jsonb),
    'likes_and_passes', coalesce((SELECT jsonb_agg(jsonb_build_object('profile_id', s.to_id, 'kind', s.kind,
                                   'at', s.created_at) ORDER BY s.created_at DESC)
                                  FROM (SELECT * FROM public.swipes WHERE from_id = _id
                                        ORDER BY created_at DESC LIMIT 5000) s), '[]'::jsonb),
    'matches', coalesce((SELECT jsonb_agg(jsonb_build_object('match_id', m.id,
                          'with_profile_id', CASE WHEN m.user_a = _id THEN m.user_b ELSE m.user_a END,
                          'matched_at', m.created_at) ORDER BY m.created_at DESC)
                         FROM public.matches m WHERE _id IN (m.user_a, m.user_b)), '[]'::jsonb),
    'messages_sent', coalesce((SELECT jsonb_agg(jsonb_build_object('match_id', x.match_id, 'type', x.message_type,
                                'text', CASE WHEN x.deleted_at IS NULL THEN x.body END,
                                'photo', CASE WHEN x.deleted_at IS NULL THEN x.image_path END,
                                'voice_note', CASE WHEN x.deleted_at IS NULL THEN x.audio_path END,
                                'sent_at', x.created_at, 'deleted_at', x.deleted_at) ORDER BY x.created_at DESC)
                               FROM (SELECT * FROM public.messages WHERE sender = _id
                                     ORDER BY created_at DESC LIMIT 2000) x), '[]'::jsonb),
    'video_calls', coalesce((SELECT jsonb_agg(jsonb_build_object('call_id', v.id, 'match_id', v.match_id,
                              'direction', CASE WHEN v.caller_id = _uid THEN 'outgoing' ELSE 'incoming' END,
                              'status', v.status, 'created_at', v.created_at, 'accepted_at', v.accepted_at,
                              'ended_at', v.ended_at) ORDER BY v.created_at DESC)
                             FROM (SELECT * FROM public.video_calls WHERE _uid IN (caller_id, recipient_id)
                                   ORDER BY created_at DESC LIMIT 1000) v), '[]'::jsonb),
    'blocked_profiles', coalesce((SELECT jsonb_agg(jsonb_build_object('profile_id', b.blocked, 'at', b.created_at))
                                  FROM public.blocks b WHERE b.blocker = _id), '[]'::jsonb),
    'reports_filed', coalesce((SELECT jsonb_agg(jsonb_build_object('profile_id', r.target, 'category', r.category,
                                'note', r.note, 'status', r.status, 'at', r.created_at) ORDER BY r.created_at DESC)
                               FROM public.reports r WHERE r.reporter = _id), '[]'::jsonb),
    'coins', jsonb_build_object(
      'balance', coalesce((SELECT w.balance FROM public.coin_wallets w WHERE w.user_id = _uid), 0),
      'transactions', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', t.kind, 'amount', t.amount,
                                  'balance_after', t.balance_after, 'at', t.created_at) ORDER BY t.created_at DESC)
                                 FROM public.coin_transactions t WHERE t.user_id = _uid), '[]'::jsonb))
  );
END
$$;
REVOKE EXECUTE ON FUNCTION public.export_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO authenticated;

COMMIT;
