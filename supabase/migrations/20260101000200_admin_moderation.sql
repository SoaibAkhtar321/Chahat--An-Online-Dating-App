CREATE TABLE public.admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  action text NOT NULL,
  target text,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_audit TO authenticated;
GRANT ALL ON public.admin_audit TO service_role;
ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit" ON public.admin_audit FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.reports ADD CONSTRAINT reports_status_check CHECK (status IN ('open','actioned','dismissed'));

-- Suspended members can't send messages.
CREATE OR REPLACE FUNCTION public.messages_sender_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.sender AND status <> 'active') THEN
    RAISE EXCEPTION 'Account suspended';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_sender_active BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_sender_active();