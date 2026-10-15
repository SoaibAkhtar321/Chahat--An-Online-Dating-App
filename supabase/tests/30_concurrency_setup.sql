-- 1 male "F" + 30 women; 10 mutual pairs (men M1..M10 / women W1..W10)
INSERT INTO auth.users(id) SELECT ('10000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid FROM generate_series(1,31) g;
INSERT INTO auth.users(id) SELECT ('20000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid FROM generate_series(1,20) g;
INSERT INTO auth.users(id,email) VALUES
  ('30000000-0000-0000-0000-000000000001','purchase-concurrency-1@x'),
  ('30000000-0000-0000-0000-000000000002','purchase-concurrency-2@x'),
  ('30000000-0000-0000-0000-000000000003','purchase-concurrency-3@x');
SET request.jwt.claim.role='service_role';
UPDATE public.profiles SET name='x',dob='1995-01-01',city='Pune',
  gender=CASE WHEN id='10000000-0000-0000-0000-000000000001' THEN 'man' WHEN id LIKE '10%' THEN 'woman' WHEN id LIKE '2000000%' AND right(id,12)::int<=10 THEN 'man' ELSE 'woman' END,
  seeking=CASE WHEN id='10000000-0000-0000-0000-000000000001' THEN 'woman' WHEN id LIKE '10%' THEN 'man' WHEN right(id,12)::int<=10 THEN 'woman' ELSE 'man' END
WHERE id LIKE '10%' OR id LIKE '20%';
CREATE TABLE public.purchase_concurrency_window AS
SELECT now() - interval '1 minute' AS starts_at,
       now() + interval '30 days' AS expires_at;
