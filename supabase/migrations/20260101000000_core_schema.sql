-- Milo core schema (from drizzle 0000). Demo profiles moved to supabase/seed.sql (dev only).
-- ===== Roles =====
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ===== Profiles (public dating profile; id = auth uid as text, or a fixed id for demo profiles) =====
CREATE TABLE public.profiles (
  id text PRIMARY KEY,
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  is_demo boolean NOT NULL DEFAULT false,
  likes_you boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 40),
  dob date,
  gender text NOT NULL DEFAULT '' CHECK (gender IN ('', 'man', 'woman')),
  seeking text NOT NULL DEFAULT '' CHECK (seeking IN ('', 'man', 'woman')),
  city text NOT NULL DEFAULT '' CHECK (char_length(city) <= 80),
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 500),
  work text NOT NULL DEFAULT '' CHECK (char_length(work) <= 80),
  education text NOT NULL DEFAULT '' CHECK (char_length(education) <= 80),
  intents text[] NOT NULL DEFAULT '{}',
  interests text[] NOT NULL DEFAULT '{}',
  languages text[] NOT NULL DEFAULT '{}',
  lifestyle jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt jsonb NOT NULL DEFAULT '{}'::jsonb,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  onboarded boolean NOT NULL DEFAULT false,
  last_active timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ===== Private per-account state (settings, filters, demo extras) =====
CREATE TABLE public.account_state (
  user_id uuid PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.account_state TO authenticated;
GRANT ALL ON public.account_state TO service_role;
ALTER TABLE public.account_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own state read" ON public.account_state FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own state insert" ON public.account_state FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own state update" ON public.account_state FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ===== Blocks =====
CREATE TABLE public.blocks (
  blocker text NOT NULL,
  blocked text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker, blocked)
);
GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;
GRANT ALL ON public.blocks TO service_role;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own blocks read" ON public.blocks FOR SELECT TO authenticated USING (blocker = auth.uid()::text);
CREATE POLICY "own blocks insert" ON public.blocks FOR INSERT TO authenticated WITH CHECK (blocker = auth.uid()::text AND blocked <> blocker);
CREATE POLICY "own blocks delete" ON public.blocks FOR DELETE TO authenticated USING (blocker = auth.uid()::text);

CREATE OR REPLACE FUNCTION public.is_blocked_pair(_a text, _b text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.blocks WHERE (blocker = _a AND blocked = _b) OR (blocker = _b AND blocked = _a))
$$;

CREATE POLICY "read own or active unblocked profiles" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid()::text OR (status = 'active' AND NOT public.is_blocked_pair(id, auth.uid()::text)));
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()::text) WITH CHECK (id = auth.uid()::text);

-- Users can't change protected columns; 18+ enforced on date of birth.
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    NEW.id := OLD.id; NEW.user_id := OLD.user_id; NEW.is_demo := OLD.is_demo;
    NEW.likes_you := OLD.likes_you; NEW.status := OLD.status; NEW.created_at := OLD.created_at;
  END IF;
  IF NEW.dob IS NOT NULL AND NEW.dob > (current_date - interval '18 years')::date THEN
    RAISE EXCEPTION 'You must be 18 or older to use Milo';
  END IF;
  IF array_length(NEW.interests, 1) > 10 OR array_length(NEW.intents, 1) > 6 OR array_length(NEW.languages, 1) > 16
     OR jsonb_array_length(NEW.photos) > 6 THEN
    RAISE EXCEPTION 'Too many items';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profiles_guard BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_guard();

-- New sign-ups get an empty profile + private state.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, user_id) VALUES (NEW.id::text, NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.account_state (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== Swipes =====
CREATE TABLE public.swipes (
  from_id text NOT NULL,
  to_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('like','pass','priority')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id, to_id)
);
GRANT SELECT, INSERT, DELETE ON public.swipes TO authenticated;
GRANT ALL ON public.swipes TO service_role;
ALTER TABLE public.swipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own swipes and likes received" ON public.swipes FOR SELECT TO authenticated
  USING (from_id = auth.uid()::text OR (to_id = auth.uid()::text AND kind <> 'pass'));
CREATE POLICY "insert own swipes" ON public.swipes FOR INSERT TO authenticated
  WITH CHECK (from_id = auth.uid()::text AND to_id <> from_id);
CREATE POLICY "undo own pass" ON public.swipes FOR DELETE TO authenticated
  USING (from_id = auth.uid()::text AND kind = 'pass');

-- ===== Matches (created only by the server) =====
CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a text NOT NULL,
  user_b text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);
GRANT SELECT, DELETE ON public.matches TO authenticated;
GRANT ALL ON public.matches TO service_role;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read match" ON public.matches FOR SELECT TO authenticated
  USING (auth.uid()::text IN (user_a, user_b));
CREATE POLICY "members unmatch" ON public.matches FOR DELETE TO authenticated
  USING (auth.uid()::text IN (user_a, user_b));

CREATE OR REPLACE FUNCTION public.is_match_member(_match uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.matches WHERE id = _match AND auth.uid()::text IN (user_a, user_b))
$$;

CREATE OR REPLACE FUNCTION public.handle_swipe()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.profiles; them public.profiles;
BEGIN
  SELECT * INTO me FROM public.profiles WHERE id = NEW.from_id;
  SELECT * INTO them FROM public.profiles WHERE id = NEW.to_id;
  IF them.id IS NULL OR them.status <> 'active' THEN RAISE EXCEPTION 'Profile not available'; END IF;
  IF me.seeking <> '' AND them.gender <> '' AND them.gender <> me.seeking THEN RAISE EXCEPTION 'Profile not available'; END IF;
  IF NEW.kind = 'pass' OR public.is_blocked_pair(NEW.from_id, NEW.to_id) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.swipes WHERE from_id = NEW.to_id AND to_id = NEW.from_id AND kind <> 'pass')
     OR (them.is_demo AND them.likes_you) THEN
    INSERT INTO public.matches (user_a, user_b)
    VALUES (least(NEW.from_id, NEW.to_id), greatest(NEW.from_id, NEW.to_id))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_swipe AFTER INSERT ON public.swipes FOR EACH ROW EXECUTE FUNCTION public.handle_swipe();

-- ===== Messages =====
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  sender text NOT NULL,
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 1000),
  image_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX messages_match_idx ON public.messages (match_id, created_at);
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read messages" ON public.messages FOR SELECT TO authenticated
  USING (public.is_match_member(match_id));
CREATE POLICY "members send messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender = auth.uid()::text AND public.is_match_member(match_id)
    AND (body <> '' OR image_path IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m WHERE m.id = match_id
      AND public.is_blocked_pair(m.user_a, m.user_b)
    )
  );
CREATE POLICY "recipient marks read" ON public.messages FOR UPDATE TO authenticated
  USING (public.is_match_member(match_id) AND sender <> auth.uid()::text)
  WITH CHECK (public.is_match_member(match_id) AND sender <> auth.uid()::text);

CREATE OR REPLACE FUNCTION public.messages_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.id := OLD.id; NEW.match_id := OLD.match_id; NEW.sender := OLD.sender;
  NEW.body := OLD.body; NEW.image_path := OLD.image_path; NEW.created_at := OLD.created_at;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_guard BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_guard();

-- Demo partners reply with a canned message (they are not real people).
CREATE OR REPLACE FUNCTION public.demo_reply(_match uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.matches; other text; n int;
  replies text[] := ARRAY['Haha, that''s sweet 😄','Tell me more!','Okay you have good taste.','Weekend plans?','Ha! Same here.'];
BEGIN
  SELECT * INTO m FROM public.matches WHERE id = _match AND auth.uid()::text IN (user_a, user_b);
  IF m.id IS NULL THEN RETURN; END IF;
  other := CASE WHEN m.user_a = auth.uid()::text THEN m.user_b ELSE m.user_a END;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = other AND is_demo) THEN RETURN; END IF;
  IF public.is_blocked_pair(m.user_a, m.user_b) THEN RETURN; END IF;
  UPDATE public.messages SET read_at = now() WHERE match_id = _match AND sender <> other AND read_at IS NULL;
  SELECT count(*) INTO n FROM public.messages WHERE match_id = _match;
  INSERT INTO public.messages (match_id, sender, body) VALUES (_match, other, replies[(n % 5) + 1]);
END $$;
REVOKE EXECUTE ON FUNCTION public.demo_reply(uuid) FROM anon;

-- ===== Reports =====
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter text NOT NULL,
  target text NOT NULL,
  category text NOT NULL CHECK (char_length(category) <= 60),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  source text NOT NULL DEFAULT 'profile' CHECK (source IN ('profile','chat','call')),
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reports read" ON public.reports FOR SELECT TO authenticated USING (reporter = auth.uid()::text);
CREATE POLICY "file report" ON public.reports FOR INSERT TO authenticated WITH CHECK (reporter = auth.uid()::text AND status = 'open');

-- ===== Realtime (idempotent; publication exists on Supabase, may not on a bare Postgres) =====
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='matches') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
    END IF;
  END IF;
END $$;
