\set ON_ERROR_STOP on
-- Task 1D: approved-only photo visibility. Owner g, viewer h.
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000f3','g@x'),('00000000-0000-0000-0000-0000000000f4','h@x');
INSERT INTO storage.objects(id,bucket_id,name) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000002','photos','00000000-0000-0000-0000-0000000000f3/a_t.jpg'),
 ('aaaaaaaa-0000-0000-0000-000000000003','photos','00000000-0000-0000-0000-0000000000f3/b.jpg'),
 ('aaaaaaaa-0000-0000-0000-000000000004','photos','00000000-0000-0000-0000-0000000000f3/verification/self.jpg');
UPDATE storage.objects SET owner='00000000-0000-0000-0000-0000000000f3'
WHERE bucket_id='photos' AND name LIKE '00000000-0000-0000-0000-0000000000f3/%';
CALL public.test_complete_profile('00000000-0000-0000-0000-0000000000f3', 'Gia', '1995-01-01', 'man', 'woman', '00000000-0000-0000-0000-0000000000f3/a.jpg');
CALL public.test_complete_profile('00000000-0000-0000-0000-0000000000f4', 'Hana', '1995-01-01', 'woman', 'man');

-- g sets owner-scoped uploaded photos as a client and attempts to forge approval.
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f3';
UPDATE public.profiles SET photos='[{"id":"a","path":"00000000-0000-0000-0000-0000000000f3/a.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f3/a_t.jpg","status":"approved"},{"id":"b","path":"00000000-0000-0000-0000-0000000000f3/b.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f3/b.jpg","status":"approved"}]'::jsonb WHERE id=auth.uid()::text;
CALL public.expect_fail('selfie path cannot be used as a profile photo',
  'UPDATE public.profiles SET photos=''[{"id":"s","path":"00000000-0000-0000-0000-0000000000f3/verification/self.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f3/verification/self.jpg"}]''::jsonb WHERE id=auth.uid()::text');
RESET ROLE;

-- selfies can never have review rows or be approved
INSERT INTO public.t_results SELECT 'selfie path gets no review row', count(*)=0, count(*)::text FROM public.photo_reviews WHERE path LIKE '%/verification/%';
SET ROLE service_role;
CALL public.expect_fail('review row for verification path rejected by constraint','INSERT INTO public.photo_reviews(owner_id,path) VALUES (''00000000-0000-0000-0000-0000000000f3'',''00000000-0000-0000-0000-0000000000f3/verification/self.jpg'')');
CALL public.expect_fail('cannot approve a selfie','SELECT public.review_photo(''00000000-0000-0000-0000-0000000000f3'',''00000000-0000-0000-0000-0000000000f3/verification/self.jpg'',''approved'',null,null)');
SELECT public.review_photo('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000f3/a.jpg','approved',null,'00000000-0000-0000-0000-0000000000f4'::uuid);
SELECT public.review_photo('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000f3/a_t.jpg','approved',null,'00000000-0000-0000-0000-0000000000f4'::uuid);
RESET ROLE;

-- viewer h: approved a + thumb only; pending b (forged approved in JSON) and selfie stay hidden
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
INSERT INTO public.t_results SELECT 'viewer storage: only approved objects readable', coalesce(array_agg(name ORDER BY name),'{}')=ARRAY['00000000-0000-0000-0000-0000000000f3/a.jpg','00000000-0000-0000-0000-0000000000f3/a_t.jpg'], coalesce(array_agg(name ORDER BY name)::text,'none') FROM storage.objects WHERE bucket_id='photos' AND name LIKE '00000000-0000-0000-0000-0000000000f3/%';
INSERT INTO public.t_results SELECT 'get_public_profile: approved only, no status key', jsonb_array_length(photos)=1 AND photos->0->>'path'='00000000-0000-0000-0000-0000000000f3/a.jpg' AND photos->0->>'thumbPath'='00000000-0000-0000-0000-0000000000f3/a_t.jpg' AND NOT (photos->0 ? 'status'), photos::text FROM public.get_public_profile('00000000-0000-0000-0000-0000000000f3');
INSERT INTO public.t_results SELECT 'discovery feed: approved only, no status key', count(*)=1 AND bool_and(jsonb_array_length(photos)=1 AND photos->0->>'path'='00000000-0000-0000-0000-0000000000f3/a.jpg' AND NOT (photos->0 ? 'status')), count(*)::text FROM public.get_discovery_feed(50) WHERE id='00000000-0000-0000-0000-0000000000f3';
RESET ROLE;

-- owner g: sees everything, with SERVER status (forged client status ignored)
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f3';
INSERT INTO public.t_results SELECT 'owner storage: sees all own objects incl. selfie', count(*)=4, count(*)::text FROM storage.objects WHERE bucket_id='photos' AND name LIKE '00000000-0000-0000-0000-0000000000f3/%';
INSERT INTO public.t_results SELECT 'get_my_photos: server status overrides forged client status',
  (SELECT e->>'status' FROM jsonb_array_elements(public.get_my_photos()) e WHERE e->>'id'='a')='approved'
  AND (SELECT e->>'status' FROM jsonb_array_elements(public.get_my_photos()) e WHERE e->>'id'='b')='pending'
  AND (SELECT e->>'status' FROM jsonb_array_elements(public.get_my_photos()) e WHERE e->>'id'='s')='pending', public.get_my_photos()::text;
DO $$ DECLARE n int; BEGIN UPDATE storage.objects SET name=name WHERE bucket_id='photos' AND name='00000000-0000-0000-0000-0000000000f3/a.jpg'; GET DIAGNOSTICS n=ROW_COUNT; INSERT INTO public.t_results VALUES('owner cannot overwrite/update a stored photo object', n=0, n::text); END $$;
RESET ROLE;

-- thumbnail approved separately: un-approving it hides the thumb but not the main photo
SET ROLE service_role; SELECT public.review_photo('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000f3/a_t.jpg','pending',null,null); RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
INSERT INTO public.t_results SELECT 'unapproved thumbPath hidden in storage and RPC', (SELECT count(*) FROM storage.objects WHERE bucket_id='photos' AND name='00000000-0000-0000-0000-0000000000f3/a_t.jpg')=0 AND (SELECT count(*) FROM storage.objects WHERE bucket_id='photos' AND name='00000000-0000-0000-0000-0000000000f3/a.jpg')=1 AND NOT (photos->0 ? 'thumbPath') AND photos->0->>'path'='00000000-0000-0000-0000-0000000000f3/a.jpg', photos::text FROM public.get_public_profile('00000000-0000-0000-0000-0000000000f3');
RESET ROLE;

-- replacement: same path, new object id => approval no longer applies
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f3';
UPDATE public.profiles
SET photos='[{"id":"b","path":"00000000-0000-0000-0000-0000000000f3/b.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f3/b.jpg"}]'::jsonb
WHERE id=auth.uid()::text;
RESET ROLE;
DELETE FROM storage.objects WHERE name='00000000-0000-0000-0000-0000000000f3/a.jpg';
INSERT INTO storage.objects(id,bucket_id,name,owner) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000005','photos','00000000-0000-0000-0000-0000000000f3/a.jpg','00000000-0000-0000-0000-0000000000f3');
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f3';
UPDATE public.profiles SET photos='[{"id":"a","path":"00000000-0000-0000-0000-0000000000f3/a.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f3/a_t.jpg","status":"approved"},{"id":"b","path":"00000000-0000-0000-0000-0000000000f3/b.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f3/b.jpg","status":"approved"}]'::jsonb WHERE id=auth.uid()::text;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
INSERT INTO public.t_results SELECT 'replaced file loses approval (storage + RPC)', (SELECT count(*) FROM storage.objects WHERE bucket_id='photos' AND name LIKE '00000000-0000-0000-0000-0000000000f3/%')=0 AND jsonb_array_length(photos)=0, photos::text FROM public.get_public_profile('00000000-0000-0000-0000-0000000000f3');
SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f3';
INSERT INTO public.t_results SELECT 'owner sees replaced photo as pending again', (SELECT e->>'status' FROM jsonb_array_elements(public.get_my_photos()) e WHERE e->>'id'='a')='pending', public.get_my_photos()::text;
RESET ROLE;
SET ROLE service_role; SELECT public.review_photo('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000f3/a.jpg','approved',null,'00000000-0000-0000-0000-0000000000f4'::uuid); RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
INSERT INTO public.t_results SELECT 're-approval of the new object restores visibility', count(*)=1, count(*)::text FROM storage.objects WHERE bucket_id='photos' AND name='00000000-0000-0000-0000-0000000000f3/a.jpg';
RESET ROLE;

-- blocked pair and suspended owner hide even approved photos
INSERT INTO public.blocks(blocker,blocked) VALUES ('00000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-0000000000f3');
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
INSERT INTO public.t_results SELECT 'blocked pair: approved photo hidden', (SELECT count(*) FROM storage.objects WHERE bucket_id='photos' AND name LIKE '00000000-0000-0000-0000-0000000000f3/%')=0 AND (SELECT count(*) FROM public.get_public_profile('00000000-0000-0000-0000-0000000000f3'))=0, 'blocked';
RESET ROLE;
DELETE FROM public.blocks WHERE blocker='00000000-0000-0000-0000-0000000000f4';
SET request.jwt.claim.role='service_role'; UPDATE public.profiles SET status='suspended' WHERE id='00000000-0000-0000-0000-0000000000f3'; RESET request.jwt.claim.role;
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
INSERT INTO public.t_results SELECT 'suspended owner: approved photo hidden', count(*)=0, count(*)::text FROM storage.objects WHERE bucket_id='photos' AND name LIKE '00000000-0000-0000-0000-0000000000f3/%';
RESET ROLE;
SET request.jwt.claim.role='service_role'; UPDATE public.profiles SET status='active' WHERE id='00000000-0000-0000-0000-0000000000f3'; RESET request.jwt.claim.role;

-- internal helpers are not client-callable
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
CALL public.expect_fail('client cannot call photo_is_public','SELECT public.photo_is_public(''00000000-0000-0000-0000-0000000000f3'',''00000000-0000-0000-0000-0000000000f3/a.jpg'')');
CALL public.expect_fail('client cannot call public_photos','SELECT public.public_photos(''00000000-0000-0000-0000-0000000000f3'',''[]''::jsonb)');
CALL public.expect_fail('client cannot call owner_photos','SELECT public.owner_photos(''00000000-0000-0000-0000-0000000000f3'',''[]''::jsonb)');
RESET ROLE;
SET ROLE anon;
CALL public.expect_fail('anon cannot call photo_object_readable','SELECT public.photo_object_readable(''00000000-0000-0000-0000-0000000000f3/a.jpg'')');
RESET ROLE;
