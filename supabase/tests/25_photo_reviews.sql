\set ON_ERROR_STOP on
-- Task 1B: photo_reviews. Uses its own users (d, e) so it does not disturb earlier files.
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000f1','d@x'),('00000000-0000-0000-0000-0000000000f2','e@x');

-- client (owner d) sets photos: forged status, thumbnail, duplicate path
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f1';
UPDATE public.profiles SET photos='[{"id":"p1","path":"00000000-0000-0000-0000-0000000000f1/a.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f1/a_t.jpg","status":"approved"},{"id":"p2","path":"00000000-0000-0000-0000-0000000000f1/b.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f1/b.jpg","status":"approved"},{"id":"p3","path":"00000000-0000-0000-0000-0000000000f1/a.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f1/a_t.jpg"}]'::jsonb WHERE id=auth.uid()::text;
RESET ROLE;
INSERT INTO public.t_results SELECT 'photo_reviews: path + thumbPath rows created, duplicates collapsed', count(*)=3, count(*)::text FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1';
INSERT INTO public.t_results SELECT 'photo_reviews: forged client status never approves', count(*) FILTER (WHERE status<>'pending')=0 AND count(*)=3, string_agg(status,',') FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1';

-- guard: foreign thumbPath rejected, foreign path still rejected
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f1';
CALL public.expect_fail('thumbPath in another user folder rejected','UPDATE public.profiles SET photos=''[{"id":"p1","path":"00000000-0000-0000-0000-0000000000f1/a.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f2/x.jpg"}]''::jsonb WHERE id=auth.uid()::text');
CALL public.expect_fail('path in another user folder still rejected','UPDATE public.profiles SET photos=''[{"id":"p1","path":"00000000-0000-0000-0000-0000000000f2/x.jpg"}]''::jsonb WHERE id=auth.uid()::text');
RESET ROLE;
INSERT INTO public.t_results SELECT 'rejected photo update leaves review rows unchanged', count(*)=3, count(*)::text FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1';

-- RLS / grants
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f1';
INSERT INTO public.t_results SELECT 'owner reads own review rows', count(*)=3, count(*)::text FROM public.photo_reviews;
CALL public.expect_fail('owner cannot read object_id','SELECT object_id FROM public.photo_reviews');
CALL public.expect_fail('owner cannot read reviewed_by','SELECT reviewed_by FROM public.photo_reviews');
CALL public.expect_fail('client cannot insert review row','INSERT INTO public.photo_reviews(owner_id,path,status) VALUES (''00000000-0000-0000-0000-0000000000f1'',''00000000-0000-0000-0000-0000000000f1/z.jpg'',''pending'')');
CALL public.expect_fail('client cannot update review status','UPDATE public.photo_reviews SET status=''approved''');
CALL public.expect_fail('client cannot delete review row','DELETE FROM public.photo_reviews');
CALL public.expect_fail('client cannot call review_photo','SELECT public.review_photo(''00000000-0000-0000-0000-0000000000f1'',''00000000-0000-0000-0000-0000000000f1/a.jpg'',''approved'',null,auth.uid())');
CALL public.expect_fail('client cannot call sync_photo_reviews','SELECT public.sync_photo_reviews(''00000000-0000-0000-0000-0000000000f1'',''[]''::jsonb)');
SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f2';
INSERT INTO public.t_results SELECT 'other user reads none of d review rows', count(*)=0, count(*)::text FROM public.photo_reviews;
RESET ROLE;
SET ROLE anon;
CALL public.expect_fail('anon cannot read photo_reviews','SELECT * FROM public.photo_reviews');
CALL public.expect_fail('anon cannot call review_photo','SELECT public.review_photo(''00000000-0000-0000-0000-0000000000f1'',''00000000-0000-0000-0000-0000000000f1/a.jpg'',''approved'',null,null)');
RESET ROLE;

-- constraints (as service_role, which has write access)
SET ROLE service_role;
CALL public.expect_fail('approval without object_id rejected by constraint','UPDATE public.photo_reviews SET status=''approved'', reviewed_at=now() WHERE owner_id=''00000000-0000-0000-0000-0000000000f1'' AND path=''00000000-0000-0000-0000-0000000000f1/a.jpg''');
CALL public.expect_fail('invalid status rejected','UPDATE public.photo_reviews SET status=''banana'' WHERE owner_id=''00000000-0000-0000-0000-0000000000f1'' AND path=''00000000-0000-0000-0000-0000000000f1/a.jpg''');
CALL public.expect_fail('pending row with reviewed_at rejected','UPDATE public.photo_reviews SET reviewed_at=now() WHERE owner_id=''00000000-0000-0000-0000-0000000000f1'' AND path=''00000000-0000-0000-0000-0000000000f1/a.jpg''');
CALL public.expect_fail('review row outside owner folder rejected','INSERT INTO public.photo_reviews(owner_id,path) VALUES (''00000000-0000-0000-0000-0000000000f1'',''00000000-0000-0000-0000-0000000000f2/x.jpg'')');
CALL public.expect_fail('review_photo approve with no stored object fails','SELECT public.review_photo(''00000000-0000-0000-0000-0000000000f1'',''00000000-0000-0000-0000-0000000000f1/a.jpg'',''approved'',null,''00000000-0000-0000-0000-0000000000f2''::uuid)');
CALL public.expect_fail('review_photo on unknown path fails','SELECT public.review_photo(''00000000-0000-0000-0000-0000000000f1'',''00000000-0000-0000-0000-0000000000f1/nope.jpg'',''rejected'',''x'',''00000000-0000-0000-0000-0000000000f2''::uuid)');
RESET ROLE;

-- approval binds to the real storage object id
INSERT INTO storage.objects(id,bucket_id,name) VALUES ('11111111-1111-1111-1111-111111111111','photos','00000000-0000-0000-0000-0000000000f1/a.jpg');
SET ROLE service_role;
SELECT public.review_photo('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f1/a.jpg','approved',null,'00000000-0000-0000-0000-0000000000f2'::uuid);
SELECT public.review_photo('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f1/b.jpg','rejected','not a face photo','00000000-0000-0000-0000-0000000000f2'::uuid);
RESET ROLE;
INSERT INTO public.t_results SELECT 'approval stores object_id + reviewer + time', status='approved' AND object_id='11111111-1111-1111-1111-111111111111' AND reviewed_by='00000000-0000-0000-0000-0000000000f2' AND reviewed_at IS NOT NULL, status||' '||coalesce(object_id::text,'null') FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1' AND path='00000000-0000-0000-0000-0000000000f1/a.jpg';
INSERT INTO public.t_results SELECT 'rejection stores reason', status='rejected' AND rejection_reason='not a face photo', status FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1' AND path='00000000-0000-0000-0000-0000000000f1/b.jpg';
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f1';
INSERT INTO public.t_results SELECT 'owner sees rejection reason', rejection_reason='not a face photo', coalesce(rejection_reason,'null') FROM public.photo_reviews WHERE path='00000000-0000-0000-0000-0000000000f1/b.jpg';
RESET ROLE;

-- reorder preserves status; removal deletes row; re-adding starts pending again
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f1';
UPDATE public.profiles SET photos='[{"id":"p2","path":"00000000-0000-0000-0000-0000000000f1/b.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f1/b.jpg"},{"id":"p1","path":"00000000-0000-0000-0000-0000000000f1/a.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f1/a_t.jpg"}]'::jsonb WHERE id=auth.uid()::text;
RESET ROLE;
INSERT INTO public.t_results SELECT 'reorder preserves approved/rejected status', (SELECT status FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1' AND path='00000000-0000-0000-0000-0000000000f1/a.jpg')='approved' AND (SELECT status FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1' AND path='00000000-0000-0000-0000-0000000000f1/b.jpg')='rejected', 'reorder';
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f1';
UPDATE public.profiles SET photos='[{"id":"p1","path":"00000000-0000-0000-0000-0000000000f1/a.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f1/a_t.jpg"}]'::jsonb WHERE id=auth.uid()::text;
RESET ROLE;
INSERT INTO public.t_results SELECT 'removed photo deletes its review row', count(*)=2 AND NOT EXISTS (SELECT 1 FROM public.photo_reviews WHERE path='00000000-0000-0000-0000-0000000000f1/b.jpg'), count(*)::text FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1';
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f1';
UPDATE public.profiles SET photos='[{"id":"p1","path":"00000000-0000-0000-0000-0000000000f1/a.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f1/a_t.jpg"},{"id":"p2","path":"00000000-0000-0000-0000-0000000000f1/b.jpg","thumbPath":"00000000-0000-0000-0000-0000000000f1/b.jpg"}]'::jsonb WHERE id=auth.uid()::text;
RESET ROLE;
INSERT INTO public.t_results SELECT 're-added path starts pending (old rejection not inherited)', status='pending' AND rejection_reason IS NULL, status FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1' AND path='00000000-0000-0000-0000-0000000000f1/b.jpg';

-- backfill: re-running sync over all profiles yields all-pending rows matching the photo JSON
SET ROLE service_role;
DELETE FROM public.photo_reviews;
SELECT public.sync_photo_reviews(p.id, p.photos) FROM public.profiles p;
RESET ROLE;
INSERT INTO public.t_results SELECT 'backfill: every row pending', count(*) FILTER (WHERE status<>'pending')=0, count(*)::text FROM public.photo_reviews;
INSERT INTO public.t_results SELECT 'backfill: row count equals distinct own-folder paths in profiles.photos',
  (SELECT count(*) FROM public.photo_reviews) = (SELECT count(*) FROM (SELECT DISTINCT p.id, e->>k AS pth FROM public.profiles p, jsonb_array_elements(p.photos) e, unnest(ARRAY['path','thumbPath']) k WHERE e->>k IS NOT NULL AND e->>k<>'' AND left(e->>k, length(p.id)+1)=p.id||'/') s),
  (SELECT count(*) FROM public.photo_reviews)::text;

-- account deletion
INSERT INTO public.t_results SELECT 'd has review rows before purge', count(*)>0, count(*)::text FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1';
SELECT public.purge_user_data('00000000-0000-0000-0000-0000000000f1');
INSERT INTO public.t_results SELECT 'purge removes review rows', count(*)=0, count(*)::text FROM public.photo_reviews WHERE owner_id='00000000-0000-0000-0000-0000000000f1';
DELETE FROM auth.users WHERE id IN ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2');
INSERT INTO public.t_results SELECT 'auth user delete leaves no review rows for d/e', count(*)=0, count(*)::text FROM public.photo_reviews WHERE owner_id IN ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2');
