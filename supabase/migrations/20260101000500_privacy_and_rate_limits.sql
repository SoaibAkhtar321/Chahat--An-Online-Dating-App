-- 20260101000500_privacy_and_rate_limits.sql
-- Part A1: Stop exposing is_demo and likes_you in get_discovery_feed and profiles column grants
-- Part A2: Revoke demo_reply from authenticated
-- Part A3: Minimal rate limits on messages (30/min) and reports (10/hr)

-- ---------- A1. Discovery feed without is_demo and likes_you ----------
DROP FUNCTION IF EXISTS public.get_discovery_feed(integer);
CREATE OR REPLACE FUNCTION public.get_discovery_feed(_limit integer DEFAULT 20)
RETURNS TABLE (id text, name text, age integer, city text, bio text, work text, education text,
               interests text[], intents text[], languages text[], lifestyle jsonb, prompt jsonb,
               photos jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _my_id text := auth.uid()::text; _seeking text; _city text;
BEGIN
  IF _my_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT pr.seeking, pr.city INTO _seeking, _city FROM public.profiles pr WHERE pr.id = _my_id;
  RETURN QUERY
  SELECT p.id, p.name, CASE WHEN p.dob IS NULL THEN 0 ELSE date_part('year', age(p.dob))::integer END,
         p.city, p.bio, p.work, p.education, p.interests, p.intents, p.languages, p.lifestyle, p.prompt,
         p.photos
  FROM public.profiles p
  WHERE p.id <> _my_id AND p.status = 'active' AND p.onboarded
    AND NOT public.is_blocked_pair(_my_id, p.id)
    AND (_seeking = '' OR p.gender = '' OR p.gender = _seeking)
    AND (_city = '' OR p.city = '' OR lower(p.city) = lower(_city))
    AND NOT EXISTS (SELECT 1 FROM public.swipes s WHERE s.from_id = _my_id AND s.to_id = p.id)
  ORDER BY p.last_active DESC
  LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
END $$;

REVOKE EXECUTE ON FUNCTION public.get_discovery_feed(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discovery_feed(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_discovery_feed(integer) TO service_role;

-- Revoke and re-grant SELECT on profiles without is_demo and likes_you
-- (exact column list from 0003 section 5 minus is_demo and likes_you)
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, user_id, status, name, gender, seeking, city, bio, work, education,
              intents, interests, languages, lifestyle, prompt, photos, onboarded, last_active, created_at)
  ON public.profiles TO authenticated;

-- ---------- A2. demo_reply: revoke from authenticated ----------
REVOKE EXECUTE ON FUNCTION public.demo_reply(uuid) FROM authenticated;

-- ---------- A3. Rate limits on messages and reports ----------
-- Indexes for efficient rolling window queries
CREATE INDEX IF NOT EXISTS messages_sender_created_at_idx ON public.messages (sender, created_at);
CREATE INDEX IF NOT EXISTS reports_reporter_created_at_idx ON public.reports (reporter, created_at);

-- Messages rate limit: max 30 per sender per rolling 60 seconds
CREATE OR REPLACE FUNCTION public.check_message_rate_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _recent_count integer;
BEGIN
  SELECT count(*) INTO _recent_count
  FROM public.messages
  WHERE sender = NEW.sender
    AND created_at >= (now() - interval '60 seconds');

  IF _recent_count >= 30 THEN
    RAISE EXCEPTION 'Too many messages. Please slow down.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS check_message_rate_limit ON public.messages;
CREATE TRIGGER check_message_rate_limit
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.check_message_rate_limit();

-- Reports rate limit: max 10 per reporter per rolling hour
CREATE OR REPLACE FUNCTION public.check_report_rate_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _recent_count integer;
BEGIN
  SELECT count(*) INTO _recent_count
  FROM public.reports
  WHERE reporter = NEW.reporter
    AND created_at >= (now() - interval '1 hour');

  IF _recent_count >= 10 THEN
    RAISE EXCEPTION 'Too many reports. Please try again later.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS check_report_rate_limit ON public.reports;
CREATE TRIGGER check_report_rate_limit
  BEFORE INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.check_report_rate_limit();
