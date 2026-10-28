-- 20260101006200_attack_surface_hardening.sql
-- Findings from an attacker-style pass as a signed-in FREE user (supabase/tests/77_attack_surface.sql).
-- Forward-only; no RPC signature changes; nothing the app uses is removed.
--
--  1. Any member could SELECT every active profile row straight from the table (name, city, gender, seeking,
--     intents, created_at, last_active, user_id, even never-onboarded accounts): a one-request scrape of the whole
--     user base and an "online tracker" via last_active. The app only ever reads its OWN row from the table;
--     other people are shown through get_public_profile / the discovery feed, which apply the visibility rules.
--     -> table reads are limited to your own row.
--  2. get_active_subscription_tier(<any user id>) was callable by members, revealing anyone's paid plan.
--     The app never calls it (server functions do, as owner). -> revoked from anon/authenticated.
--  3. (Kept, low risk) the legacy get_discovery_feed(_limit) is still callable. It returns nothing the current feed
--     does not, and older regression suites exercise it; revoke it once those suites move to get_discovery_feed_page.
--  4. Members could INSERT chat messages with message_type 'system' (forging "missed call"/"call ended" history
--     or system notices) and could set created_at (pin a message "in the future"), delivered_at, read_at,
--     viewed_at and deleted_at. -> client inserts: no 'system' type; server-owned columns forced.
--  5. TRUNCATE (which bypasses RLS) was granted to members on public tables (platform default). Not reachable
--     through the REST API, but there is no reason to hold it. -> revoked.
--  6. Reports could name a non-existent account or yourself (moderation noise). -> target must be another
--     existing profile.
--  7. account_state.data accepted multi-megabyte blobs from the client (storage abuse). -> 16 KB cap for clients.
BEGIN;

-- 1. Own profile row only (others via get_public_profile / feed RPCs).
DROP POLICY IF EXISTS "read own or active unblocked profiles" ON public.profiles;
DROP POLICY IF EXISTS "read own profile" ON public.profiles;
CREATE POLICY "read own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (auth.uid())::text);

-- 2. Not for clients.
REVOKE EXECUTE ON FUNCTION public.get_active_subscription_tier(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_subscription_tier(text) TO service_role;

-- 4. Client message inserts.
CREATE OR REPLACE FUNCTION public.messages_client_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Server code (triggers/functions owned by the database owner, service_role) may write anything valid.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.message_type = 'system' THEN
    RAISE EXCEPTION 'System messages can only be created by the server';
  END IF;
  NEW.created_at := now();
  NEW.delivered_at := NULL;
  NEW.read_at := NULL;
  NEW.viewed_at := NULL;
  NEW.deleted_at := NULL;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.messages_client_insert_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS messages_client_insert_guard ON public.messages;
CREATE TRIGGER messages_client_insert_guard
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_client_insert_guard();

-- 5. No TRUNCATE for API roles.
DO $$
DECLARE _t record;
BEGIN
  FOR _t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon, authenticated', _t.tablename);
  END LOOP;
END $$;

-- 6. Reports must target another real account.
CREATE OR REPLACE FUNCTION public.reports_target_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') AND current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.target IS NULL OR NEW.target = NEW.reporter
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.target) THEN
    RAISE EXCEPTION 'Report target is not a valid member';
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.reports_target_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reports_target_guard ON public.reports;
CREATE TRIGGER reports_target_guard
  BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.reports_target_guard();

-- 7. Size cap on client-written private state.
CREATE OR REPLACE FUNCTION public.account_state_size_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND octet_length(coalesce(NEW.data, '{}'::jsonb)::text) > 16384 THEN
    RAISE EXCEPTION 'Account settings are too large';
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.account_state_size_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS account_state_size_guard ON public.account_state;
CREATE TRIGGER account_state_size_guard
  BEFORE INSERT OR UPDATE ON public.account_state
  FOR EACH ROW EXECUTE FUNCTION public.account_state_size_guard();

COMMIT;
