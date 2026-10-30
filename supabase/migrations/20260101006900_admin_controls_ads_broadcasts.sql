-- 20260101006900_admin_controls_ads_broadcasts.sql
-- Admin panel expansion (2026-10-30). Forward-only; no existing policy, column or RPC signature is changed.
--
-- 1. Suspension is enforced: a suspended member can no longer send chat messages (before, suspension only hid the
--    profile from Discover and blocked likes and calls; messages still went through). The app also shows a
--    "suspended" screen (get_my_account_status).
-- 2. Sponsored cards in Discover ("ads"): created by staff in the admin panel, shown between profiles with a clear
--    "Sponsored" label. Ad images live in the public 'ads' bucket (an ad is public by nature; no member data there).
--    Members can only read active, in-date ads targeted at them, and record their own impression / click (one of each
--    per ad per member per day, so counts cannot be inflated).
-- 3. Broadcast notifications ("announcements"): staff send an update or offer to a segment. Delivery is done by the
--    admin-api function; this adds the history table and the members' "Offers & announcements" opt-out
--    (notification_preferences.updates, default on, honoured for every broadcast).
-- 4. purchase_attempts: every verify-purchase call by a signed-in member (verified / pending / failed / retryable),
--    without tokens, so staff can see failed transactions.
-- 5. admin_daily_metrics(from, to): business report rows for the admin "Business reports" export.
-- Every new table has RLS enabled. Staff tables have no member policies at all (service role only: the admin-api
-- function checks the staff role, then acts with the service key).
BEGIN;

-- ---------- 1. Suspension enforcement ----------
CREATE OR REPLACE FUNCTION public.messages_sender_active_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- System rows (call history, written by SECURITY DEFINER functions as the table owner) are not member sends.
  IF coalesce(NEW.message_type, 'text') = 'system' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.sender AND p.status = 'active') THEN
    RAISE EXCEPTION 'Your account is suspended' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.messages_sender_active_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS messages_sender_active_guard ON public.messages;
CREATE TRIGGER messages_sender_active_guard
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_sender_active_guard();

CREATE OR REPLACE FUNCTION public.get_my_account_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('status', coalesce((SELECT p.status FROM public.profiles p WHERE p.id = auth.uid()::text), 'unknown'))
  WHERE auth.uid() IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_account_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_account_status() TO authenticated;

-- ---------- 2. Ads ----------
CREATE TABLE IF NOT EXISTS public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser text NOT NULL CHECK (char_length(advertiser) BETWEEN 1 AND 60),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 300),
  image_path text CHECK (image_path IS NULL OR image_path ~ '^creatives/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  cta_label text NOT NULL DEFAULT 'Learn more' CHECK (char_length(cta_label) BETWEEN 1 AND 24),
  cta_url text CHECK (cta_url IS NULL OR (cta_url ~ '^https://' AND char_length(cta_url) <= 500)),
  target_gender text NOT NULL DEFAULT '' CHECK (target_gender IN ('', 'man', 'woman')),
  target_cities text[] NOT NULL DEFAULT '{}',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT false,
  weight integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ads TO service_role;
CREATE INDEX IF NOT EXISTS ads_live_idx ON public.ads (active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.ad_events (
  ad_id uuid NOT NULL REFERENCES public.ads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('impression', 'click')),
  day date NOT NULL DEFAULT (timezone('Asia/Kolkata', now()))::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_id, user_id, kind, day)
);
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ad_events TO service_role;
CREATE INDEX IF NOT EXISTS ad_events_day_idx ON public.ad_events (day, ad_id);
CREATE INDEX IF NOT EXISTS ad_events_user_idx ON public.ad_events (user_id);

-- Public bucket for ad creatives only (ads are public content). Max 1 MB, images only. Uploads: service role only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ads', 'ads', true, 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Ads for the signed-in member: active, in date, matching their gender preference and city (when targeted).
CREATE OR REPLACE FUNCTION public.get_discover_ads(_limit integer DEFAULT 5)
RETURNS TABLE (id uuid, advertiser text, title text, body text, image_path text, cta_label text, cta_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.advertiser, a.title, a.body, a.image_path, a.cta_label, a.cta_url
  FROM public.ads a
  JOIN public.profiles me ON me.id = auth.uid()::text AND me.status = 'active' AND me.onboarded
  WHERE a.active AND a.starts_at <= now() AND (a.ends_at IS NULL OR a.ends_at > now())
    AND (a.target_gender = '' OR a.target_gender = me.gender)
    AND (cardinality(a.target_cities) = 0 OR lower(me.city) = ANY (SELECT lower(c) FROM unnest(a.target_cities) c))
  ORDER BY random() * a.weight DESC
  LIMIT least(greatest(coalesce(_limit, 5), 1), 10);
$$;
REVOKE EXECUTE ON FUNCTION public.get_discover_ads(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discover_ads(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_ad_event(_ad_id uuid, _kind text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _kind NOT IN ('impression', 'click') THEN RAISE EXCEPTION 'Invalid ad event'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ads a WHERE a.id = _ad_id AND a.active) THEN RETURN false; END IF;
  INSERT INTO public.ad_events (ad_id, user_id, kind) VALUES (_ad_id, auth.uid(), _kind)
  ON CONFLICT DO NOTHING;
  RETURN true;
END
$$;
REVOKE EXECUTE ON FUNCTION public.record_ad_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_ad_event(uuid, text) TO authenticated;

-- ---------- 3. Broadcast notifications ----------
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS updates boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 200),
  segment jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(segment) = 'object'),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  recipients integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  finished_at timestamptz
);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.announcements FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.announcements TO service_role;

-- Device tokens of the members in a segment who allow "Offers & announcements" (service role only).
CREATE OR REPLACE FUNCTION public.announcement_targets(_segment jsonb, _after uuid DEFAULT NULL, _limit integer DEFAULT 500)
RETURNS TABLE (device_id uuid, push_token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.token
  FROM public.push_devices d
  JOIN public.profiles p ON p.id = d.user_id::text
  LEFT JOIN public.notification_preferences pref ON pref.user_id = d.user_id
  WHERE d.active AND p.status = 'active' AND p.onboarded AND NOT p.is_demo
    AND coalesce(pref.updates, true)
    AND (_after IS NULL OR d.id > _after)
    AND (coalesce(_segment->>'gender', '') = '' OR p.gender = _segment->>'gender')
    AND (coalesce(_segment->>'city', '') = '' OR lower(p.city) = lower(_segment->>'city'))
    AND (coalesce(_segment->>'plan', '') = ''
         OR (_segment->>'plan' = 'free' AND public.get_active_subscription_tier(p.id) = 'free')
         OR (_segment->>'plan' = 'paid' AND public.get_active_subscription_tier(p.id) <> 'free'))
  ORDER BY d.id
  LIMIT least(greatest(coalesce(_limit, 500), 1), 1000);
$$;
REVOKE EXECUTE ON FUNCTION public.announcement_targets(jsonb, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.announcement_targets(jsonb, uuid, integer) TO service_role;

-- ---------- 4. Purchase attempts ----------
CREATE TABLE IF NOT EXISTS public.purchase_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  store text NOT NULL DEFAULT 'google_play',
  product_id text CHECK (product_id IS NULL OR char_length(product_id) <= 80),
  outcome text NOT NULL CHECK (outcome IN ('verified', 'pending', 'failed', 'retryable')),
  http_status integer,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.purchase_attempts TO service_role;
CREATE INDEX IF NOT EXISTS purchase_attempts_created_idx ON public.purchase_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_attempts_user_idx ON public.purchase_attempts (user_id);

-- ---------- 5. Business report ----------
CREATE OR REPLACE FUNCTION public.admin_daily_metrics(_from date, _to date)
RETURNS TABLE (
  day date, signups integer, profiles_completed integer, likes integer, matches integer, messages integer,
  video_calls integer, reports integer, new_paid_orders integer, revenue_inr numeric, failed_payments integer,
  ad_impressions integer, ad_clicks integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH days AS (
    SELECT d::date AS day FROM generate_series(_from, least(_to, _from + 366), interval '1 day') d
  ),
  b AS (SELECT day, (day::timestamp AT TIME ZONE 'Asia/Kolkata') AS s,
               ((day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS e FROM days)
  SELECT b.day,
    (SELECT count(*) FROM auth.users u WHERE u.created_at >= b.s AND u.created_at < b.e)::int,
    (SELECT count(*) FROM public.profiles p WHERE p.onboarded AND NOT p.is_demo AND p.created_at >= b.s AND p.created_at < b.e)::int,
    (SELECT count(*) FROM public.swipes w WHERE w.kind <> 'pass' AND w.created_at >= b.s AND w.created_at < b.e)::int,
    (SELECT count(*) FROM public.matches m WHERE m.created_at >= b.s AND m.created_at < b.e)::int,
    (SELECT count(*) FROM public.messages x WHERE x.created_at >= b.s AND x.created_at < b.e AND coalesce(x.message_type, 'text') <> 'system')::int,
    (SELECT count(*) FROM public.video_calls v WHERE v.accepted_at >= b.s AND v.accepted_at < b.e)::int,
    (SELECT count(*) FROM public.reports r WHERE r.created_at >= b.s AND r.created_at < b.e)::int,
    (SELECT count(*) FROM public.subscription_orders o WHERE o.created_at >= b.s AND o.created_at < b.e AND o.store <> 'manual_grant')::int,
    (SELECT coalesce(sum(o.amount_inr), 0) FROM public.subscription_orders o WHERE o.created_at >= b.s AND o.created_at < b.e AND o.store <> 'manual_grant'),
    (SELECT count(*) FROM public.purchase_attempts a WHERE a.outcome = 'failed' AND a.created_at >= b.s AND a.created_at < b.e)::int,
    (SELECT count(*) FROM public.ad_events ae WHERE ae.kind = 'impression' AND ae.day = b.day)::int,
    (SELECT count(*) FROM public.ad_events ae WHERE ae.kind = 'click' AND ae.day = b.day)::int
  FROM b
  ORDER BY b.day;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_daily_metrics(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_daily_metrics(date, date) TO service_role;

COMMIT;
