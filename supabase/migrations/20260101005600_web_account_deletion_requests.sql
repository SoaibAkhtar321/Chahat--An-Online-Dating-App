-- Website account-deletion requests (/delete-account on the Chahat website).
-- The website only SUBMITS a request; the server-side function executes the same deletion as the in-app option.
-- user_id has no foreign key on purpose: the audit row must survive deletion of the auth user.
BEGIN;

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  source       text NOT NULL DEFAULT 'web',
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- At most one open request per user: duplicate submissions collapse into the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_one_open
  ON public.account_deletion_requests (user_id) WHERE status IN ('pending', 'processing', 'failed');

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, status, requested_at, processed_at) ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;
DROP POLICY IF EXISTS "read own deletion requests" ON public.account_deletion_requests;
CREATE POLICY "read own deletion requests" ON public.account_deletion_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid());

COMMIT;
