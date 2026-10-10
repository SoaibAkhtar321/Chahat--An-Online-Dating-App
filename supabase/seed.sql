-- DEVELOPMENT ONLY. Loaded by `supabase db reset` (local) via config.toml [db.seed].
-- NEVER run against production. Demo profiles are fake and photos are bundled in the app.
INSERT INTO public.profiles (id, is_demo, likes_you, name, dob, gender, seeking, city, onboarded) VALUES
  ('ananya', true, true,  'Ananya', '1999-03-10', 'woman', 'man', 'Mumbai', true),
  ('meera',  true, false, 'Meera',  '2001-03-10', 'woman', 'man', 'Bengaluru', true),
  ('riya',   true, true,  'Riya',   '1997-03-10', 'woman', 'man', 'Jaipur', true),
  ('sneha',  true, true,  'Sneha',  '1998-03-10', 'woman', 'man', 'Pune', true),
  ('ishita', true, false, 'Ishita', '2002-03-10', 'woman', 'man', 'Kolkata', true),
  ('kavya',  true, true,  'Kavya',  '2000-03-10', 'woman', 'man', 'Hyderabad', true)
ON CONFLICT (id) DO NOTHING;
