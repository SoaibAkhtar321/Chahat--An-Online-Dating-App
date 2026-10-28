-- 20260101006000_agora_channel_events.sql
-- Optional reconciliation of the daily call allowance with Agora's server-side channel events (Agora Console →
-- Webhooks → RTC; received by the agora-ncs Edge Function, HMAC-verified). Forward-only, OFF by default.
--
-- Why: since 20260101005800 the allowance clock starts once BOTH participants were issued an Agora token. That is
-- the earliest moment media can flow, so it is safe, but a call where both got tokens and the connection then
-- failed is still charged. Agora's join/leave events are the only server-side proof of who was in the channel.
--
-- Rules (never grant more than the token-based charge):
--   * Events are stored once per Agora noticeId (duplicates/retries are ignored) and only for a real call channel
--     (call_<uuid>) and one of that call's two participants (Agora "account" = our user id).
--   * Per participant, events are ordered by Agora's clientSeq (delivery order is not guaranteed) and paired
--     join → leave. Evidence for a call is COMPLETE only when the call has ended, at least one event arrived, and
--     every participant who has events has only closed join/leave pairs (no join without leave, no leave without
--     join). Incomplete evidence (late, lost or out-of-order events) changes nothing.
--   * With complete evidence, a call is charged min(token-based seconds, seconds BOTH were in the channel).
--     So events can only reduce a charge to the real overlap; they can never extend the window or add time.
--   * app_settings.call_agora_reconcile_enabled = 1 turns it on (default 0). Turn it on only after the webhook is
--     configured and its health check passes; while 0 the tables still fill so you can compare.
-- Residual limit: a participant whose join AND leave events were BOTH lost after Agora's retries looks as if they
-- never joined. Clients cannot cause that (events come from Agora, not the app); monitor
-- public.agora_events_unpaired for operational loss.
BEGIN;

INSERT INTO public.app_settings (key, value) VALUES ('call_agora_reconcile_enabled', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.call_media_events (
  notice_id text PRIMARY KEY CHECK (length(notice_id) BETWEEN 1 AND 128),
  call_id uuid NOT NULL REFERENCES public.video_calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('join', 'leave')),
  event_type integer NOT NULL,
  client_seq bigint NOT NULL,
  event_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_media_events_call_idx ON public.call_media_events (call_id, user_id, client_seq);
ALTER TABLE public.call_media_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_media_events FROM PUBLIC, anon, authenticated;

-- ---------- Ingest (service_role only: the agora-ncs Edge Function after signature verification) ----------
CREATE OR REPLACE FUNCTION public.record_agora_channel_event(
  _notice_id text, _event_type integer, _channel text, _account text, _client_seq bigint, _ts_seconds bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _call_id uuid;
  _user uuid;
  _kind text;
  _inserted integer;
BEGIN
  IF _notice_id IS NULL OR length(_notice_id) NOT BETWEEN 1 AND 128 THEN
    RETURN jsonb_build_object('ok', true, 'status', 'ignored', 'reason', 'notice_id');
  END IF;
  _kind := CASE WHEN _event_type IN (103, 105, 107) THEN 'join'
                WHEN _event_type IN (104, 106, 108) THEN 'leave' END;
  IF _kind IS NULL THEN RETURN jsonb_build_object('ok', true, 'status', 'ignored', 'reason', 'event_type'); END IF;
  IF _channel IS NULL OR _channel !~ '^call_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     OR _account IS NULL OR _account !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     OR _client_seq IS NULL OR _ts_seconds IS NULL
     -- Agora reports seconds since epoch; reject nonsense (before 2024 or more than a day ahead).
     OR _ts_seconds < 1704067200 OR to_timestamp(_ts_seconds) > now() + interval '1 day' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'ignored', 'reason', 'payload');
  END IF;
  _call_id := substr(_channel, 6)::uuid;
  _user := _account::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.video_calls c WHERE c.id = _call_id AND _user IN (c.caller_id, c.recipient_id)) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'ignored', 'reason', 'not_a_participant');
  END IF;

  INSERT INTO public.call_media_events (notice_id, call_id, user_id, kind, event_type, client_seq, event_at)
  VALUES (_notice_id, _call_id, _user, _kind, _event_type, _client_seq, to_timestamp(_ts_seconds))
  ON CONFLICT (notice_id) DO NOTHING;
  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN _inserted = 1 THEN 'recorded' ELSE 'duplicate' END);
END
$$;
REVOKE EXECUTE ON FUNCTION public.record_agora_channel_event(text, integer, text, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_agora_channel_event(text, integer, text, text, bigint, bigint) TO service_role;

-- ---------- Seconds both participants were in the channel; NULL when the evidence is not complete ----------
CREATE OR REPLACE FUNCTION public.call_media_overlap_seconds(_call_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _call public.video_calls;
  _ev record;
  _open timestamptz;
  _cur uuid;
  _a_start timestamptz[] := '{}'; _a_end timestamptz[] := '{}';
  _b_start timestamptz[] := '{}'; _b_end timestamptz[] := '{}';
  _total numeric := 0;
  i integer; j integer;
BEGIN
  SELECT * INTO _call FROM public.video_calls WHERE id = _call_id;
  IF _call.id IS NULL OR _call.ended_at IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.call_media_events e WHERE e.call_id = _call_id) THEN RETURN NULL; END IF;

  _cur := NULL;
  FOR _ev IN
    SELECT e.user_id, e.kind, e.event_at FROM public.call_media_events e
    WHERE e.call_id = _call_id ORDER BY e.user_id, e.client_seq, e.event_at
  LOOP
    IF _cur IS DISTINCT FROM _ev.user_id THEN
      IF _open IS NOT NULL THEN RETURN NULL; END IF;      -- previous participant still "in": no leave yet
      _cur := _ev.user_id; _open := NULL;
    END IF;
    IF _ev.kind = 'join' THEN
      IF _open IS NOT NULL THEN RETURN NULL; END IF;      -- two joins in a row: a leave is missing
      _open := _ev.event_at;
    ELSE
      IF _open IS NULL THEN RETURN NULL; END IF;          -- leave without join: the join is missing
      IF _ev.user_id = _call.caller_id THEN
        _a_start := _a_start || _open; _a_end := _a_end || greatest(_open, _ev.event_at);
      ELSE
        _b_start := _b_start || _open; _b_end := _b_end || greatest(_open, _ev.event_at);
      END IF;
      _open := NULL;
    END IF;
  END LOOP;
  IF _open IS NOT NULL THEN RETURN NULL; END IF;

  FOR i IN 1 .. coalesce(array_length(_a_start, 1), 0) LOOP
    FOR j IN 1 .. coalesce(array_length(_b_start, 1), 0) LOOP
      _total := _total + greatest(0, extract(epoch FROM (least(_a_end[i], _b_end[j]) - greatest(_a_start[i], _b_start[j]))));
    END LOOP;
  END LOOP;
  RETURN floor(_total)::integer;
END
$$;
REVOKE EXECUTE ON FUNCTION public.call_media_overlap_seconds(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- Allowance usage: token-based (005800), optionally reduced to the proven overlap ----------
CREATE OR REPLACE FUNCTION public.call_allowance_used_today(_uid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(
           CASE WHEN public.billing_setting_int('call_agora_reconcile_enabled', 0, 0, 1) = 1
                     AND public.call_media_overlap_seconds(t.id) IS NOT NULL
                THEN least(t.token_based, public.call_media_overlap_seconds(t.id))
                ELSE t.token_based END), 0)::integer
  FROM (
    SELECT c.id,
           greatest(0, least(
             coalesce(c.billing_free_seconds, 0),
             floor(extract(epoch FROM (
               coalesce(c.ended_at, now())
               - coalesce(c.allowance_started_at,
                          c.connected_at,
                          c.accepted_at + make_interval(secs => public.billing_setting_int('call_connect_grace_seconds', 30, 0, 120)))
             )))))::integer AS token_based
    FROM public.video_calls c
    WHERE c.caller_id = _uid
      AND c.accepted_at IS NOT NULL
      AND c.accepted_at >= (timezone('Asia/Kolkata', now())::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
  ) t;
$$;
REVOKE EXECUTE ON FUNCTION public.call_allowance_used_today(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- Operations: calls whose event evidence never completed (lost / late webhooks) ----------
CREATE OR REPLACE VIEW public.agora_events_unpaired WITH (security_invoker = true) AS
SELECT c.id AS call_id, c.ended_at, count(e.*) AS events
FROM public.video_calls c
JOIN public.call_media_events e ON e.call_id = c.id
WHERE c.ended_at IS NOT NULL AND c.ended_at < now() - interval '5 minutes'
GROUP BY c.id, c.ended_at
HAVING public.call_media_overlap_seconds(c.id) IS NULL;
REVOKE ALL ON public.agora_events_unpaired FROM PUBLIC, anon, authenticated;

COMMIT;
